import type { ChatMessage } from '../types';
import type { CallEndReason, CallMedia } from '../types/call';
import { Dialog, Toast } from 'antd-mobile';
import i18n from '../i18n';
import wsService from './websocket';
import { callApi } from '../api';
import { openAppSettings, isNativePlatform } from './appSettings';
import { setNativeSpeakerphone, releaseNativeAudio } from './callAudio';
import { useCallStore } from '../store/useCallStore';
import { useAuthStore } from '../store/useAuthStore';
import { useContactStore } from '../store/useContactStore';

/** 兜底 ICE 服务器（后端 /call/ice-config 不可用时使用；TURN 由后端临时凭证下发） */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * 通话管理器（单例）：负责 WebRTC 协商、媒体流与信令收发。
 * 信令复用既有 WebSocket（CALL_* 瞬时消息，服务端不落库）；媒体走 P2P。
 */
class CallManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private role: 'caller' | 'callee' | null = null;
  private iceServers: RTCIceServer[] = ICE_SERVERS;
  private iceRefreshTimer: number | null = null;

  private myId(): string {
    return String(useAuthStore.getState().user?.userId ?? '');
  }

  private send(type: string, to: string, headers: Record<string, string>): boolean {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      type,
      from: this.myId(),
      to,
      group: false,
      content: '',
      headers,
    };
    return wsService.send(msg);
  }

  private peerName(userId: string): string {
    const f = useContactStore.getState().friends.find((x) => String(x.userId) === String(userId));
    return f?.nickname || f?.username || userId;
  }

  private peerAvatar(userId: string): string | undefined {
    return useContactStore.getState().friends.find((x) => String(x.userId) === String(userId))?.avatar;
  }

  private async openLocalMedia(media: CallMedia) {
    const constraints: MediaStreamConstraints =
      media === 'video' ? { audio: true, video: true } : { audio: true, video: false };
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    useCallStore.getState().setPeerStreams(this.localStream, this.remoteStream);
  }

  /**
   * 主叫等待接听期间的本地采集：视频只开摄像头做本地预览、语音不采集。
   * 关键在于此时**不开麦克风**——否则 WebView 的 WebRTC 会把音频切到通话模式，
   * 音量键调的是通话音量，铃声（铃声流）音量无法调整。麦克风延后到接听后补上。
   */
  private async openOutgoingPreview(media: CallMedia) {
    if (media !== 'video') {
      return;
    }
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    useCallStore.getState().setPeerStreams(this.localStream, this.remoteStream);
  }

  /** 接通后补齐麦克风（主叫在收到接听后调用）；已存在音频轨则跳过 */
  private async attachMicrophone() {
    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      return;
    }
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = audioStream.getAudioTracks()[0];
    if (!track) {
      return;
    }
    track.enabled = !useCallStore.getState().muted;
    if (this.localStream) {
      this.localStream.addTrack(track);
    } else {
      this.localStream = audioStream;
    }
    useCallStore.getState().setPeerStreams(this.localStream, this.remoteStream);
  }

  /** 采集失败（多为相机/麦克风权限被拒）：结束通话并引导开启权限 */
  private failPermission() {
    this.end('permission');
    const t = i18n.t.bind(i18n);
    if (isNativePlatform()) {
      // 原生 App：弹窗引导一键跳转系统权限设置（用户常不知如何开启）
      Dialog.show({
        content: t('call.permissionDenied'),
        closeOnAction: true,
        actions: [
          {
            key: 'settings',
            text: t('call.openSettings'),
            bold: true,
            onClick: () => {
              void openAppSettings();
            },
          },
          { key: 'cancel', text: t('common.cancel') },
        ],
      });
    } else {
      Toast.show({ content: t('call.permissionDenied') });
    }
  }

  /** 建连前拉取 ICE 配置（含 TURN 临时凭证）；失败则保留兜底 STUN。并按 TTL 定时刷新（预热后续呼叫/重连配置） */
  private async loadIceServers() {
    try {
      const res = await callApi.getIceConfig();
      const servers = res?.data?.iceServers;
      if (Array.isArray(servers) && servers.length > 0) {
        this.iceServers = servers;
      }
      this.scheduleIceRefresh(Number(res?.data?.ttl));
    } catch (e) {
      console.warn('loadIceServers failed, fallback to default STUN:', e);
    }
  }

  /** 在 TURN 凭证过期前刷新（默认提前 5 分钟，最短 30 秒），避免长通话/重连时凭证失效 */
  private scheduleIceRefresh(ttlSeconds: number) {
    if (this.iceRefreshTimer) {
      clearTimeout(this.iceRefreshTimer);
    }
    // 通话已结束（await 期间被 end()）：不再排定时器，避免空闲态永久自续
    const phase = useCallStore.getState().phase;
    if (phase === 'idle' || phase === 'ended') {
      this.iceRefreshTimer = null;
      return;
    }
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 3600;
    const delayMs = Math.max(30_000, (ttl - 300) * 1000);
    this.iceRefreshTimer = window.setTimeout(() => {
      this.iceRefreshTimer = null;
      const p = useCallStore.getState().phase;
      if (p === 'idle' || p === 'ended') {
        return;
      }
      void this.loadIceServers();
    }, delayMs);
  }

  private clearIceRefresh() {
    if (this.iceRefreshTimer) {
      clearTimeout(this.iceRefreshTimer);
      this.iceRefreshTimer = null;
    }
  }

  /** 主叫发起呼叫 */
  async start(peerId: string, name: string, avatar: string | undefined, media: CallMedia) {
    if (useCallStore.getState().phase !== 'idle') {
      return;
    }
    const callId = crypto.randomUUID();
    this.role = 'caller';
    useCallStore.getState().beginOutgoing({ id: peerId, name, avatar }, callId, media);
    try {
      // 仅视频做本地预览；不采集麦克风（见 openOutgoingPreview 注释）
      await this.openOutgoingPreview(media);
    } catch (e) {
      console.error('getUserMedia failed:', e);
      this.failPermission();
      return;
    }
    // 异步期间用户可能已取消：复核状态，避免发出已放弃的呼叫
    if (useCallStore.getState().phase !== 'outgoing' || this.role !== 'caller') {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      return;
    }
    await this.loadIceServers();
    if (useCallStore.getState().phase !== 'outgoing' || this.role !== 'caller') {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      return;
    }
    if (!this.send('CALL_INVITE', peerId, { callId, media })) {
      this.end('failed');
    }
  }

  /** 被叫接听 */
  async accept() {
    const s = useCallStore.getState();
    if (s.phase !== 'incoming' || !s.callId || !s.peer) {
      return;
    }
    this.role = 'callee';
    s.setPhase('connecting');
    try {
      await this.openLocalMedia(s.media);
    } catch (e) {
      console.error('getUserMedia failed:', e);
      // 本端无法采集：通知主叫并结束（原因：权限）
      this.send('CALL_REJECT', s.peer.id, { callId: s.callId, reason: 'permission' });
      this.failPermission();
      return;
    }
    // 异步期间用户可能已拒接/取消
    const st = useCallStore.getState();
    if (st.phase !== 'connecting' || this.role !== 'callee' || !st.callId || !st.peer) {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      return;
    }
    await this.loadIceServers();
    const st2 = useCallStore.getState();
    if (st2.phase !== 'connecting' || this.role !== 'callee' || !st2.callId || !st2.peer) {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      return;
    }
    if (!this.send('CALL_ACCEPT', st2.peer.id, { callId: st2.callId })) {
      this.end('failed');
    }
  }

  /** 被叫拒接 */
  reject() {
    const s = useCallStore.getState();
    if (s.callId && s.peer) {
      this.send('CALL_REJECT', s.peer.id, { callId: s.callId });
    }
    this.end('hangup');
  }

  /** 挂断/取消 */
  hangup() {
    const s = useCallStore.getState();
    if (s.callId && s.peer) {
      const type = s.phase === 'outgoing' ? 'CALL_CANCEL' : 'CALL_HANGUP';
      this.send(type, s.peer.id, { callId: s.callId });
    }
    this.end('hangup');
  }

  toggleMute(): boolean {
    const s = useCallStore.getState();
    const next = !s.muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !next));
    s.setMuted(next);
    return next;
  }

  toggleCamera(): boolean {
    const s = useCallStore.getState();
    const next = !s.cameraOff;
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !next));
    s.setCameraOff(next);
    return next;
  }

  /** 前后摄像头切换（视频通话）：优先原地 applyConstraints（不重开摄像头，更快）；不支持时回退重开新轨 */
  async flipCamera(): Promise<void> {
    const s = useCallStore.getState();
    if (s.media !== 'video' || !this.localStream) {
      return;
    }
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (!oldTrack) {
      return;
    }
    const current = oldTrack.getSettings?.().facingMode;
    const facingMode = current === 'environment' ? 'user' : 'environment';

    // 优化路径：设备支持 facingMode 能力时原地切换
    try {
      const caps = oldTrack.getCapabilities?.() as (MediaTrackCapabilities & { facingMode?: string[] }) | undefined;
      if (Array.isArray(caps?.facingMode) && caps.facingMode.length > 1) {
        await oldTrack.applyConstraints({ facingMode: { ideal: facingMode } } as MediaTrackConstraints);
        return;
      }
    } catch (e) {
      console.warn('applyConstraints facingMode failed, fallback to reopen camera:', e);
    }

    // 回退路径：重开摄像头新轨并替换
    let newTrack: MediaStreamTrack | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode } });
      newTrack = stream.getVideoTracks()[0];
      if (!newTrack || !this.localStream) {
        newTrack?.stop();
        return;
      }
      newTrack.enabled = !s.cameraOff;
      const sender = this.pc?.getSenders().find((sn) => sn.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
      this.localStream.removeTrack(oldTrack);
      this.localStream.addTrack(newTrack);
      oldTrack.stop();
    } catch (e) {
      newTrack?.stop();
      console.error('flipCamera failed:', e);
      throw e;
    }
  }

  /**
   * 切换扬声器/听筒：Android WebView 无标准 API，尽力而为——通过 setSinkId 选择输出设备；
   * 设备/浏览器不支持时抛错，由 UI 给出提示（不改变状态）。
   */
  async toggleSpeaker(): Promise<void> {
    const s = useCallStore.getState();
    const next = !s.speakerOn;
    const changed = await this.applyAudioOutput(next);
    if (!changed) {
      throw new Error('speaker-unsupported');
    }
    useCallStore.getState().setSpeakerOn(next);
  }

  private async applyAudioOutput(speaker: boolean): Promise<boolean> {
    // 原生 App：走 AudioManager 切扬声器/听筒
    if (isNativePlatform()) {
      // 响铃期不切音频模式：通话模式下音量键调的是通话音量，会让铃声大小无法调节。
      // 实际音频路由在接通后由 markActive → setNativeSpeakerphone 应用。
      const phase = useCallStore.getState().phase;
      if (phase === 'outgoing' || phase === 'incoming') {
        return true;
      }
      return setNativeSpeakerphone(speaker);
    }
    // Web：尽力而为，通过 setSinkId 选择输出设备
    const el = document.querySelector('[data-call-output]') as
      | (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (!el || typeof el.setSinkId !== 'function' || !navigator.mediaDevices?.enumerateDevices) {
      return false;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const pick = devices
        .filter((d) => d.kind === 'audiooutput')
        .find((d) => {
          const label = (d.label || '').toLowerCase();
          return speaker
            ? label.includes('speaker') || label.includes('扬声')
            : label.includes('earpiece') || label.includes('听筒') || label.includes('receiver');
        });
      if (!pick) {
        return false;
      }
      await el.setSinkId(pick.deviceId);
      return true;
    } catch (e) {
      console.warn('applyAudioOutput failed:', e);
      return false;
    }
  }

  /** 处理入站信令 */
  handleSignal(msg: ChatMessage) {
    const h = msg.headers || {};
    const callId = h.callId || '';
    const media = (h.media as CallMedia) || 'audio';
    // 忽略非当前通话的迟到信令（避免旧通话信令误关进行中的通话）
    const current = useCallStore.getState().callId;
    if (msg.type !== 'CALL_INVITE' && callId && current && callId !== current) {
      return;
    }
    switch (msg.type) {
      case 'CALL_INVITE': {
        if (useCallStore.getState().phase !== 'idle') {
          this.send('CALL_BUSY', msg.from, { callId });
          return;
        }
        useCallStore.getState().beginIncoming(
          { id: msg.from, name: this.peerName(msg.from), avatar: this.peerAvatar(msg.from) },
          callId,
          media,
        );
        this.send('CALL_RINGING', msg.from, { callId });
        break;
      }
      case 'CALL_ACCEPT':
        if (this.role === 'caller') {
          this.onAccepted();
        }
        break;
      case 'CALL_REJECT':
        this.end('rejected');
        break;
      case 'CALL_BUSY':
        this.end('busy');
        break;
      case 'CALL_CANCEL':
        this.end('canceled');
        break;
      case 'CALL_OFFER':
        this.onOffer(h.sdp || '');
        break;
      case 'CALL_ANSWER':
        this.onAnswer(h.sdp || '');
        break;
      case 'CALL_ICE':
        this.onRemoteIce(h.candidate || '');
        break;
      case 'CALL_HANGUP': {
        const reason = h.reason || '';
        const st = useCallStore.getState();
        if (reason === 'accepted_elsewhere') {
          // 被叫其余设备：已被其他端接听 → 静默收场（不闪"已取消"浮层）
          if (st.phase === 'connecting' || st.phase === 'active') {
            return; // 接听设备自身忽略
          }
          useCallStore.getState().reset();
          return;
        }
        this.end(st.phase === 'active' ? 'hangup' : 'canceled');
        break;
      }
      case 'CALL_TIMEOUT':
        this.end('timeout');
        break;
      default:
        break;
    }
  }

  private createPc() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    this.remoteStream = new MediaStream();
    pc.onicecandidate = (e) => {
      const s = useCallStore.getState();
      if (e.candidate && s.callId && s.peer) {
        this.send('CALL_ICE', s.peer.id, { callId: s.callId, candidate: JSON.stringify(e.candidate) });
      }
    };
    pc.ontrack = (e) => {
      this.remoteStream?.addTrack(e.track);
      useCallStore.getState().setPeerStreams(this.localStream, this.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (useCallStore.getState().phase !== 'active') {
          useCallStore.getState().markActive();
          // 接通后按当前状态应用扬声器路由（原生）
          void setNativeSpeakerphone(useCallStore.getState().speakerOn);
        }
      } else if (pc.connectionState === 'failed') {
        if (useCallStore.getState().phase !== 'ended') {
          this.end('failed');
        }
      }
    };
    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
  }

  /** 主叫：收到接听 → 补齐麦克风、建连并发送 Offer */
  private async onAccepted() {
    useCallStore.getState().setPhase('connecting');
    try {
      await this.attachMicrophone();
    } catch (e) {
      console.error('getUserMedia(mic) failed:', e);
      const s = useCallStore.getState();
      if (s.peer && s.callId) {
        this.send('CALL_HANGUP', s.peer.id, { callId: s.callId });
      }
      this.failPermission();
      return;
    }
    // 异步期间用户可能已挂断
    const st = useCallStore.getState();
    if (st.phase !== 'connecting' || this.role !== 'caller' || !st.peer) {
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      return;
    }
    this.createPc();
    try {
      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);
      const s = useCallStore.getState();
      this.send('CALL_OFFER', s.peer!.id, { callId: s.callId!, sdp: offer.sdp || '' });
    } catch (e) {
      console.error('createOffer failed:', e);
      this.end('failed');
    }
  }

  /** 被叫：收到 Offer → 应答 */
  private async onOffer(sdp: string) {
    // 结束后可能仍有 in-flight OFFER 到达：非连接中/非被叫则忽略，避免重建并泄漏 pc
    if (useCallStore.getState().phase !== 'connecting' || this.role !== 'callee') {
      return;
    }
    this.createPc();
    try {
      await this.pc!.setRemoteDescription({ type: 'offer', sdp });
      await this.flushCandidates();
      const answer = await this.pc!.createAnswer();
      await this.pc!.setLocalDescription(answer);
      const s = useCallStore.getState();
      this.send('CALL_ANSWER', s.peer!.id, { callId: s.callId!, sdp: answer.sdp || '' });
    } catch (e) {
      console.error('createAnswer failed:', e);
      this.end('failed');
    }
  }

  /** 主叫：收到 Answer */
  private async onAnswer(sdp: string) {
    try {
      await this.pc?.setRemoteDescription({ type: 'answer', sdp });
      await this.flushCandidates();
    } catch (e) {
      console.error('setRemoteDescription(answer) failed:', e);
    }
  }

  private async onRemoteIce(candidateJson: string) {
    if (!candidateJson) {
      return;
    }
    try {
      const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
      if (this.pc && this.pc.remoteDescription) {
        await this.pc.addIceCandidate(candidate);
      } else {
        this.pendingCandidates.push(candidate);
      }
    } catch (e) {
      console.error('addIceCandidate failed:', e);
    }
  }

  private async flushCandidates() {
    if (!this.pc) {
      return;
    }
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (e) {
        console.error('flush candidate failed:', e);
      }
    }
  }

  private end(reason: CallEndReason) {
    try {
      this.pc?.close();
    } catch (e) {
      /* ignore */
    }
    this.pc = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.role = null;
    this.clearIceRefresh();
    void releaseNativeAudio();
    useCallStore.getState().markEnded(reason);
  }
}

export const callManager = new CallManager();
export default callManager;
