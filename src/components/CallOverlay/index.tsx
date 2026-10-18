import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Toast } from 'antd-mobile';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, PictureInPicture2, SwitchCamera, Volume2, VolumeX } from 'lucide-react';
import { useCallStore } from '../../store/useCallStore';
import callManager from '../../services/call';
import { useCachedMediaUrl } from '../../hooks/useCachedMediaUrl';
import { useBackGuard } from '../../hooks/useBackGuard';
import type { CallEndReason } from '../../types/call';
import styles from './CallOverlay.module.css';

const reasonKey = (r: CallEndReason | null): string => {
  switch (r) {
    case 'rejected': return 'call.rejected';
    case 'canceled': return 'call.canceled';
    case 'busy': return 'call.busy';
    case 'timeout': return 'call.noAnswer';
    case 'failed': return 'call.failed';
    case 'permission': return 'call.permissionDenied';
    default: return 'call.ended';
  }
};

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function CallOverlay() {
  const { t } = useTranslation();
  const phase = useCallStore((s) => s.phase);
  const peer = useCallStore((s) => s.peer);
  const media = useCallStore((s) => s.media);
  const muted = useCallStore((s) => s.muted);
  const cameraOff = useCallStore((s) => s.cameraOff);
  const speakerOn = useCallStore((s) => s.speakerOn);
  const minimized = useCallStore((s) => s.minimized);
  const startedAt = useCallStore((s) => s.startedAt);
  const endReason = useCallStore((s) => s.endReason);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);

  const [elapsed, setElapsed] = useState(0);
  const [swapped, setSwapped] = useState(false);
  // 悬浮小窗位置（null = 默认右上角）；拖动后固定为 left/top
  const [miniPos, setMiniPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean; w: number; h: number } | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerAvatar = useCachedMediaUrl(peer?.avatar, true);

  useEffect(() => {
    if (phase !== 'active' || !startedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  // 非通话中重置"主画面/小窗互换"状态
  useEffect(() => {
    if (phase !== 'active') setSwapped(false);
  }, [phase]);

  // 本地视频流 → 对应 <video>（本地画面静音）
  useEffect(() => {
    if (localRef.current && localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream, media, phase, minimized, swapped]);

  // 远端视频流 → 视频元素；远端音频统一走独立 <audio>（避免视频元素重复出声）
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, media, phase, minimized, swapped]);

  useEffect(() => {
    const el = remoteAudioRef.current;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
      el.play?.().catch(() => {});
    }
  }, [remoteStream, phase, minimized]);

  useEffect(() => {
    if (phase === 'ended') {
      const id = setTimeout(() => useCallStore.getState().reset(), 1800);
      return () => clearTimeout(id);
    }
  }, [phase]);

  const isVideo = media === 'video';
  const ringing = phase === 'outgoing' || phase === 'incoming';
  const inCall = phase === 'connecting' || phase === 'active';
  const canMinimize = phase === 'outgoing' || inCall;
  // 视频画面：通话中/连接中/呼叫中（来电未接前仍显示头像）
  const showVideoSurface = isVideo && phase !== 'incoming' && phase !== 'ended';

  useBackGuard(phase !== 'idle' && !!peer, () => {
    const state = useCallStore.getState();
    if (state.minimized) {
      state.setMinimized(false);
      return;
    }
    if (state.phase === 'incoming') {
      callManager.reject();
    } else if (state.phase === 'ended') {
      state.reset();
    } else {
      callManager.hangup();
    }
  });

  if (phase === 'idle' || !peer) {
    return null;
  }

  let status = '';
  if (phase === 'outgoing') status = t('call.calling');
  else if (phase === 'incoming') status = isVideo ? t('call.incomingVideo') : t('call.incomingVoice');
  else if (phase === 'connecting') status = t('call.connecting');
  else if (phase === 'active') status = fmtDuration(elapsed);
  else if (phase === 'ended') status = t(reasonKey(endReason));

  const avatarNode = peerAvatar.url && !peerAvatar.failed ? (
    <img className={styles.avatar} src={peerAvatar.url} alt="" onError={peerAvatar.onError} />
  ) : (
    <div className={`${styles.avatar} ${styles.avatarFallback}`}>{(peer.name || '?').slice(0, 1).toUpperCase()}</div>
  );

  const onSpeaker = async () => {
    try {
      await callManager.toggleSpeaker();
    } catch {
      Toast.show({ content: t('call.speakerUnsupported') });
    }
  };

  const onFlip = async () => {
    try {
      await callManager.flipCamera();
    } catch {
      Toast.show({ content: t('call.flipFailed') });
    }
  };

  // 悬浮小窗拖动：拖动移动位置，轻点（未移动）还原通话界面
  const onMiniPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: rect.left,
      baseY: rect.top,
      moved: false,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMiniPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) {
      return;
    }
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      d.moved = true;
    }
    const x = Math.min(Math.max(0, d.baseX + dx), Math.max(0, window.innerWidth - d.w));
    const y = Math.min(Math.max(0, d.baseY + dy), Math.max(0, window.innerHeight - d.h));
    setMiniPos({ x, y });
  };
  const onMiniPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d && !d.moved) {
      useCallStore.getState().setMinimized(false);
    }
  };

  // 最小化：右上角悬浮小窗（视频显示画面：未接通显示本端、接通后显示对方；语音显示头像）
  if (minimized && canMinimize) {
    const miniShowsRemote = isVideo && phase === 'active';
    return (
      <div
        className={styles.miniWindow}
        style={miniPos ? { left: miniPos.x, top: miniPos.y, right: 'auto' } : undefined}
        onPointerDown={onMiniPointerDown}
        onPointerMove={onMiniPointerMove}
        onPointerUp={onMiniPointerUp}
        onPointerCancel={onMiniPointerUp}
      >
        <div className={styles.miniPreview}>
          {isVideo ? (
            <video
              ref={miniShowsRemote ? remoteVideoRef : localRef}
              className={styles.miniVideo}
              autoPlay
              playsInline
              muted
            />
          ) : (
            <span className={styles.miniBigAvatar}>
              {peerAvatar.url && !peerAvatar.failed
                ? <img src={peerAvatar.url} alt="" onError={peerAvatar.onError} />
                : (peer.name || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className={styles.miniMeta}>
            <span className={styles.miniName}>{peer.name}</span>
            <span className={styles.miniTime}>{phase === 'active' ? fmtDuration(elapsed) : t('call.connecting')}</span>
          </span>
        </div>
        <div className={styles.miniQuick}>
          <button className={styles.miniBtn} onClick={() => callManager.toggleMute()} aria-label={t('call.mute')}>
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          {isVideo && (
            <button className={styles.miniBtn} onClick={() => callManager.toggleCamera()} aria-label={t('call.cameraOff')}>
              {cameraOff ? <VideoOff size={16} /> : <Video size={16} />}
            </button>
          )}
          <button className={`${styles.miniBtn} ${styles.miniBtnHangup}`} onClick={() => callManager.hangup()} aria-label={t('call.hangup')}>
            <PhoneOff size={16} />
          </button>
        </div>
        {/* 最小化时仍保留远端音频输出元素（全屏子树已卸载） */}
        <audio ref={remoteAudioRef} className={styles.hiddenMedia} autoPlay playsInline data-call-output />
      </div>
    );
  }

  // 视频：主画面为对方（接通后）或本端（未接通）；接通后点小窗可互换
  const mainIsLocal = phase !== 'active' || swapped;
  const swap = () => setSwapped((v) => !v);

  return (
    <div className={`${styles.overlay} ${showVideoSurface ? styles.videoMode : ''}`}>
      {!showVideoSurface && peerAvatar.url && !peerAvatar.failed && (
        <img className={styles.callBg} src={peerAvatar.url} alt="" onError={peerAvatar.onError} />
      )}
      <div className={styles.scrim} />

      {showVideoSurface && (
        <>
          <video
            ref={mainIsLocal ? localRef : remoteVideoRef}
            className={styles.videoMain}
            autoPlay
            playsInline
            muted
            onClick={phase === 'active' ? swap : undefined}
          />
          {phase === 'active' && (
            <video
              ref={mainIsLocal ? remoteVideoRef : localRef}
              className={styles.videoPip}
              autoPlay
              playsInline
              muted
              onClick={(e) => { e.stopPropagation(); swap(); }}
            />
          )}
        </>
      )}

      {/* 远端声音统一走独立 audio（视频元素仅画面，避免重复出声） */}
      <audio ref={remoteAudioRef} className={styles.hiddenMedia} autoPlay playsInline data-call-output />

      {canMinimize && (
        <button className={styles.minimizeBtn} onClick={() => useCallStore.getState().setMinimized(true)} aria-label={t('call.minimize')}>
          <PictureInPicture2 size={20} strokeWidth={2} />
        </button>
      )}

      {showVideoSurface ? (
        <div className={styles.videoHeader}>
          <div className={styles.name}>{peer.name}</div>
          <div className={styles.status}>
            {phase === 'active' && <span className={styles.statusDot} />}
            {status}
          </div>
        </div>
      ) : (
        <div className={styles.center}>
          <div className={`${styles.avatarWrap} ${ringing ? styles.ringing : ''}`}>
            <div className={styles.ring} />
            {ringing && <div className={`${styles.ring} ${styles.ring2}`} />}
            {ringing && <div className={`${styles.ring} ${styles.ring3}`} />}
            {avatarNode}
          </div>
          <div className={styles.name}>{peer.name}</div>
          <div className={styles.status}>
            {phase === 'active' && <span className={styles.statusDot} />}
            {status}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        {phase === 'incoming' && (
          <>
            <button className={styles.action} onClick={() => callManager.reject()}>
              <span className={`${styles.btn} ${styles.btnReject}`}><PhoneOff /></span>
              <span className={styles.actionLabel}>{t('call.reject')}</span>
            </button>
            <button className={styles.action} onClick={() => callManager.accept()}>
              <span className={`${styles.btn} ${styles.btnAccept}`}><Phone /></span>
              <span className={styles.actionLabel}>{t('call.accept')}</span>
            </button>
          </>
        )}

        {(inCall || phase === 'outgoing') && isVideo && (
          <div className={styles.actionGrid}>
            <button className={styles.action} onClick={() => callManager.toggleMute()}>
              <span className={`${styles.btn} ${muted ? '' : styles.btnOn}`}>{muted ? <MicOff /> : <Mic />}</span>
              <span className={styles.actionLabel}>{muted ? t('call.unmute') : t('call.mute')}</span>
            </button>
            <button className={styles.action} onClick={onSpeaker}>
              <span className={`${styles.btn} ${speakerOn ? styles.btnOn : ''}`}>{speakerOn ? <Volume2 /> : <VolumeX />}</span>
              <span className={styles.actionLabel}>{speakerOn ? t('call.speakerOn') : t('call.speakerOff')}</span>
            </button>
            <button className={styles.action} onClick={() => callManager.toggleCamera()}>
              <span className={`${styles.btn} ${cameraOff ? '' : styles.btnOn}`}>{cameraOff ? <VideoOff /> : <Video />}</span>
              <span className={styles.actionLabel}>{cameraOff ? t('call.cameraOn') : t('call.cameraOff')}</span>
            </button>
            <button className={styles.action} onClick={onFlip}>
              <span className={styles.btn}><SwitchCamera /></span>
              <span className={styles.actionLabel}>{t('call.flipCamera')}</span>
            </button>
            <button className={styles.action} onClick={() => callManager.hangup()}>
              <span className={`${styles.btn} ${styles.btnHangup}`}><PhoneOff /></span>
              <span className={styles.actionLabel}>{t('call.hangup')}</span>
            </button>
          </div>
        )}

        {(inCall || phase === 'outgoing') && !isVideo && (
          <div className={styles.actionGrid}>
            <button className={styles.action} onClick={() => callManager.toggleMute()}>
              <span className={`${styles.btn} ${muted ? '' : styles.btnOn}`}>{muted ? <MicOff /> : <Mic />}</span>
              <span className={styles.actionLabel}>{muted ? t('call.unmute') : t('call.mute')}</span>
            </button>
            <button className={styles.action} onClick={() => callManager.hangup()}>
              <span className={`${styles.btn} ${styles.btnHangup}`}><PhoneOff /></span>
              <span className={styles.actionLabel}>{t('call.hangup')}</span>
            </button>
            <button className={styles.action} onClick={onSpeaker}>
              <span className={`${styles.btn} ${speakerOn ? styles.btnOn : ''}`}>{speakerOn ? <Volume2 /> : <VolumeX />}</span>
              <span className={styles.actionLabel}>{speakerOn ? t('call.speakerOn') : t('call.speakerOff')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
