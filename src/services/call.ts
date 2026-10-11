import type { ChatMessage } from '../types';
import type { CallEndReason, CallMedia } from '../types/call';
import wsService from './websocket';
import { useCallStore } from '../store/useCallStore';
import { useAuthStore } from '../store/useAuthStore';
import { useContactStore } from '../store/useContactStore';

/** ICE 服务器（第一轮仅公共 STUN；TURN/coturn 在后续接入，由后端下发） */
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

  /** 主叫发起呼叫 */
  async start(peerId: string, name: string, avatar: string | undefined, media: CallMedia) {
    if (useCallStore.getState().phase !== 'idle') {
      return;
    }
    const callId = crypto.randomUUID();
    this.role = 'caller';
    useCallStore.getState().beginOutgoing({ id: peerId, name, avatar }, callId, media);
    try {
      await this.openLocalMedia(media);
    } catch (e) {
      console.error('getUserMedia failed:', e);
      this.end('permission');
      return;
    }
    // 异步期间用户可能已取消：复核状态，避免发出已放弃的呼叫
    if (useCallStore.getState().phase !== 'outgoing' || this.role !== 'caller') {
      this.localStream?.getTracks().forEach((t) => t.stop());
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
      this.end('permission');
      return;
    }
    // 异步期间用户可能已拒接/取消
    const st = useCallStore.getState();
    if (st.phase !== 'connecting' || this.role !== 'callee' || !st.callId || !st.peer) {
      this.localStream?.getTracks().forEach((t) => t.stop());
      return;
    }
    if (!this.send('CALL_ACCEPT', st.peer.id, { callId: st.callId })) {
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
        }
      } else if (pc.connectionState === 'failed') {
        if (useCallStore.getState().phase !== 'ended') {
          this.end('failed');
        }
      }
    };
    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
  }

  /** 主叫：收到接听 → 建连并发送 Offer */
  private async onAccepted() {
    useCallStore.getState().setPhase('connecting');
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
    useCallStore.getState().markEnded(reason);
  }
}

export const callManager = new CallManager();
export default callManager;
