import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCallStore } from '../../store/useCallStore';
import callManager from '../../services/call';
import type { CallEndReason } from '../../types/call';
import styles from './CallOverlay.module.css';

/** 标准听筒路径（正立=接听；旋转 135°=挂断/拒接/取消） */
const HANDSET_PATH =
  'M6.6 10.9a15.4 15.4 0 0 0 6.5 6.5l2.1-2.1a1 1 0 0 1 1-.24 11 11 0 0 0 3.4.54 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1 11 11 0 0 0 .54 3.4 1 1 0 0 1-.24 1z';

const Svg = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const AcceptIcon = (
  <Svg>
    <path d={HANDSET_PATH} />
  </Svg>
);
const HangupIcon = (
  <Svg className={styles.rotated}>
    <path d={HANDSET_PATH} />
  </Svg>
);
const MicIcon = (
  <Svg>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
  </Svg>
);
const MicOffIcon = (
  <Svg>
    <path d="M9 5a3 3 0 0 1 6 0v6M9 9v2a3 3 0 0 0 4.5 2.6M6 11a6 6 0 0 0 9 5.2M12 17v4M4 4l16 16" />
  </Svg>
);
const VideoIcon = (
  <Svg>
    <rect x="3" y="6" width="12" height="12" rx="2.5" />
    <path d="M15 10l5-3v10l-5-3z" />
  </Svg>
);
const VideoOffIcon = (
  <Svg>
    <path d="M15 10l5-3v10l-3-1.8M3 6h9a2.5 2.5 0 0 1 2.5 2.5M4 4l16 16" />
  </Svg>
);
const MinimizeIcon = (
  <Svg>
    <path d="M5 9l7 6 7-6" />
  </Svg>
);

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
  const minimized = useCallStore((s) => s.minimized);
  const startedAt = useCallStore((s) => s.startedAt);
  const endReason = useCallStore((s) => s.endReason);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);

  const [elapsed, setElapsed] = useState(0);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (phase !== 'active' || !startedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  useEffect(() => {
    if (localRef.current && localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream, media, phase]);

  useEffect(() => {
    const el = media === 'video' ? remoteVideoRef.current : remoteAudioRef.current;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
      el.play?.().catch(() => {});
    }
  }, [remoteStream, media, phase]);

  useEffect(() => {
    if (phase === 'ended') {
      const id = setTimeout(() => useCallStore.getState().reset(), 1800);
      return () => clearTimeout(id);
    }
  }, [phase]);

  const isVideo = media === 'video';
  const showVideo = isVideo && phase === 'active';
  const ringing = phase === 'outgoing' || phase === 'incoming';
  const inCall = phase === 'connecting' || phase === 'active';

  if (phase === 'idle' || !peer) {
    return null;
  }

  let status = '';
  if (phase === 'outgoing') status = t('call.calling');
  else if (phase === 'incoming') status = isVideo ? t('call.incomingVideo') : t('call.incomingVoice');
  else if (phase === 'connecting') status = t('call.connecting');
  else if (phase === 'active') status = fmtDuration(elapsed);
  else if (phase === 'ended') status = t(reasonKey(endReason));

  const avatarNode = peer.avatar ? (
    <img className={styles.avatar} src={peer.avatar} alt="" />
  ) : (
    <div className={`${styles.avatar} ${styles.avatarFallback}`}>{(peer.name || '?').slice(0, 1).toUpperCase()}</div>
  );

  // 最小化：通话中/连接中折叠。聊天页由页面内联的"通话条"承载（不遮挡消息）；其他页面用悬浮胶囊。
  if (minimized && inCall) {
    // 通话对象所在会话页由页面内联"通话条"承载；其他页面（含其他会话）用悬浮胶囊，保证入口始终可见
    const onPeerChatPage = window.location.pathname === `/chat/${peer.id}`;
    return (
      <>
        {!onPeerChatPage && (
          <button className={styles.miniPill} onClick={() => useCallStore.getState().setMinimized(false)}>
            <span className={styles.miniAvatar}>
              {peer.avatar ? <img src={peer.avatar} alt="" /> : (peer.name || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.miniMeta}>
              <span className={styles.miniName}>{peer.name}</span>
              <span className={styles.miniTime}>{phase === 'active' ? fmtDuration(elapsed) : t('call.connecting')}</span>
            </span>
            <Svg className={styles.miniChevron}>
              <path d="M6 15l6-6 6 6" />
            </Svg>
          </button>
        )}
        <audio ref={remoteAudioRef} className={styles.hiddenMedia} autoPlay playsInline />
      </>
    );
  }

  return (
    <div className={`${styles.overlay} ${showVideo ? styles.videoMode : ''}`}>
      <div className={`${styles.glow} ${styles.glowA}`} />
      <div className={`${styles.glow} ${styles.glowB}`} />
      <div className={styles.scrim} />

      {showVideo && <video ref={remoteVideoRef} className={styles.videoRemote} autoPlay playsInline />}
      {showVideo && <video ref={localRef} className={styles.videoLocal} autoPlay playsInline muted />}
      <audio ref={remoteAudioRef} className={styles.hiddenMedia} autoPlay playsInline />

      <div className={styles.top}>
        <span className={styles.mediaTag}>{isVideo ? t('call.video') : t('call.voice')}</span>
        {showVideo && (
          <>
            <div className={styles.name}>{peer.name}</div>
            <div className={styles.status}>
              {phase === 'active' && <span className={styles.statusDot} />}
              {status}
            </div>
          </>
        )}
      </div>

      <div className={styles.center}>
        <div className={`${styles.avatarWrap} ${ringing ? styles.ringing : ''}`}>
          <div className={`${styles.ring} ${ringing ? styles.ring1 : styles.ringStatic}`} />
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

      <div className={styles.actions}>
        {phase === 'incoming' && (
          <>
            <button className={styles.action} onClick={() => callManager.reject()}>
              <span className={`${styles.btn} ${styles.btnReject}`}>{HangupIcon}</span>
              <span className={styles.actionLabel}>{t('call.reject')}</span>
            </button>
            <button className={styles.action} onClick={() => callManager.accept()}>
              <span className={`${styles.btn} ${styles.btnAccept}`}>{AcceptIcon}</span>
              <span className={styles.actionLabel}>{t('call.accept')}</span>
            </button>
          </>
        )}

        {phase === 'outgoing' && (
          <button className={styles.action} onClick={() => callManager.hangup()}>
            <span className={`${styles.btn} ${styles.btnHangup}`}>{HangupIcon}</span>
            <span className={styles.actionLabel}>{t('call.cancel')}</span>
          </button>
        )}

        {inCall && (
          <>
            <button className={styles.action} onClick={() => callManager.toggleMute()}>
              <span className={`${styles.btn} ${muted ? styles.btnMuted : ''}`}>{muted ? MicOffIcon : MicIcon}</span>
              <span className={styles.actionLabel}>{muted ? t('call.unmute') : t('call.mute')}</span>
            </button>
            {isVideo && (
              <button className={styles.action} onClick={() => callManager.toggleCamera()}>
                <span className={`${styles.btn} ${cameraOff ? styles.btnMuted : ''}`}>
                  {cameraOff ? VideoOffIcon : VideoIcon}
                </span>
                <span className={styles.actionLabel}>{cameraOff ? t('call.cameraOn') : t('call.cameraOff')}</span>
              </button>
            )}
            <button className={styles.action} onClick={() => useCallStore.getState().setMinimized(true)}>
              <span className={styles.btn}>{MinimizeIcon}</span>
              <span className={styles.actionLabel}>{t('call.minimize')}</span>
            </button>
            <button className={styles.action} onClick={() => callManager.hangup()}>
              <span className={`${styles.btn} ${styles.btnHangup}`}>{HangupIcon}</span>
              <span className={styles.actionLabel}>{t('call.hangup')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
