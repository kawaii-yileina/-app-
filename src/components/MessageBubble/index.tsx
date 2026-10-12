import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileOutline } from 'antd-mobile-icons';
import { Toast } from 'antd-mobile';
import { PlayIcon, PauseIcon } from '../icons';
import { resolveFileUrl } from '../../utils/fileUrl';
import { avatarTint } from '../../utils/avatarColor';
import { formatCallRecordText } from '../../utils/messagePreview';
import type { Message } from '../../types';
import styles from './index.module.css';

interface Props {
  message: Message;
  isSelf: boolean;
  senderName?: string;
  senderAvatar?: string;
  showSenderName?: boolean;
  onAvatarClick?: () => void;
  onAvatarLongPress?: () => void;
  onImageClick?: (src: string) => void;
  onLongPress?: () => void;
  /** 重发回调（失败状态的重发按钮） */
  onResend?: () => void;
  /** 引用块中展示的被引用消息发送者名称 */
  replySenderName?: string;
  /** 点击引用块（定位原消息） */
  onQuoteClick?: () => void;
  /** 点击正文中被 @ 的成员 */
  onMentionClick?: (userId: string) => void;
}

interface ContactCardData {
  userId: string;
  nickname: string;
  avatar: string;
}

/** 图片消息：加载失败时显示占位，避免被误认为发送失败 */
const MediaImage = ({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={styles.imageFailed} onClick={onClick}>
        {alt}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={styles.image}
      onClick={onClick}
      onError={() => setFailed(true)}
    />
  );
};

/** 全局唯一正在播放的语音元素，保证同时只播放一条 */
let activeAudio: HTMLAudioElement | null = null;

/**
 * 根据消息 id 生成稳定的随机波形（同一消息每次渲染一致，不同消息不同）。
 * 高度范围 30%~95%。
 */
const generateBars = (seed: string): number[] => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < 16; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bars.push(Math.round(30 + (state / 0xffffffff) * 65));
  }
  return bars;
};

/**
 * 语音气泡（微信风格）：宽度随时长变化，点击播放/暂停，播放时声波动画 + 进度。
 * 时长优先取消息头 duration（MediaRecorder 的 WebM 常缺时长元数据）。
 */
const VoiceBubble = ({ src, duration, seed }: { src: string; duration: number; seed: string }) => {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const bars = useMemo(() => generateBars(seed || src), [seed, src]);

  const stopRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopRaf();
      const audio = audioRef.current;
      if (audio) {
        audio.onpause = null;
        audio.pause();
        if (activeAudio === audio) activeAudio = null;
      }
    };
  }, []);

  const tick = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const total = duration > 0 ? duration : (Number.isFinite(audio.duration) ? audio.duration : 0);
    setProgress(total > 0 ? Math.min(1, audio.currentTime / total) : 0);
    if (!audio.paused && !audio.ended) {
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const getAudio = (): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio(resolveFileUrl(src));
    audio.preload = 'auto';
    audio.onplay = () => {
      setPlaying(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    };
    audio.onpause = () => {
      setPlaying(false);
      stopRaf();
      if (activeAudio === audio) activeAudio = null;
    };
    audio.onended = () => {
      setPlaying(false);
      setProgress(0);
      stopRaf();
      if (activeAudio === audio) activeAudio = null;
    };
    audio.onerror = () => {
      setPlaying(false);
      stopRaf();
      Toast.show({ content: t('chat.voicePlayFailed') });
    };
    audioRef.current = audio;
    return audio;
  };

  const toggle = async () => {
    const audio = getAudio();
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // 暂停其他正在播放的语音
    if (activeAudio && activeAudio !== audio) {
      activeAudio.pause();
    }
    activeAudio = audio;
    try {
      await audio.play();
    } catch (e) {
      Toast.show({ content: t('chat.voicePlayFailed') });
    }
  };

  const width = Math.min(200, 96 + Math.min(Math.max(duration, 1), 60) * 1.8);

  return (
    <div
      className={styles.voiceBubble}
      style={{ width }}
      onClick={toggle}
    >
      <span className={styles.voicePlayBtn}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </span>
      <span className={styles.voiceWaveform}>
        {bars.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
        {playing && <span className={styles.voiceCursor} style={{ left: `${progress * 100}%` }} />}
      </span>
      <span className={styles.voiceDuration}>{Math.max(1, Math.round(duration))}″</span>
    </div>
  );
};

const Avatar = ({ name, src, onClick, onLongPress }: {
  name?: string; src?: string; onClick?: () => void; onLongPress?: () => void;
}) => {
  const resolvedSrc = src ? resolveFileUrl(src) : undefined;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 长按已触发：用于吞掉随之而来的 click，避免误触 onClick（如跳转资料页） */
  const longPressFired = useRef(false);

  const content = resolvedSrc ? (
    <img src={resolvedSrc} alt={name || 'avatar'} className={styles.imgAvatar} />
  ) : (
    <div className={styles.avatar} style={{ background: avatarTint(name || '') }}>
      {name?.charAt(0) || '?'}
    </div>
  );

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const startLongPress = () => {
    if (!onLongPress) return;
    longPressFired.current = false;
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onLongPress();
    }, 500);
  };

  useEffect(() => clearLongPressTimer, []);

  const handleClick = (e: React.MouseEvent) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.();
  };

  return (
    <div
      className={styles.avatarClickable}
      onClick={handleClick}
      onTouchStart={startLongPress}
      onTouchEnd={clearLongPressTimer}
      onTouchMove={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault();
      }}
    >
      {content}
    </div>
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatSize = (sizeStr?: string) => {
  const size = Number(sizeStr);
  if (!size || isNaN(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const MessageBubble = ({ message, isSelf, senderName, senderAvatar, showSenderName, onAvatarClick, onAvatarLongPress, onImageClick, onLongPress, onResend, replySenderName, onQuoteClick, onMentionClick }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  /** 正文中 @昵称 高亮并可点击 */
  const renderTextWithMentions = (text: string) => {
    const names = (message.mentions || []).map((m) => m.nickname).filter(Boolean);
    if (names.length === 0) return text;
    const pattern = new RegExp(`@(${names.map(escapeRegExp).join('|')})`, 'g');
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      const nickname = match[1];
      const target = (message.mentions || []).find((m) => m.nickname === nickname);
      parts.push(
        <span
          key={`${match.index}_${nickname}`}
          className={styles.mentionText}
          onClick={(e) => {
            e.stopPropagation();
            if (target) onMentionClick?.(target.userId);
          }}
        >
          @{nickname}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  };

  // 气泡长按（所有消息类型）：弹出操作菜单
  const handleBubbleLongPress = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onLongPress?.();
  };

  const renderContactCard = () => {
    let card: ContactCardData;
    try {
      card = JSON.parse(message.content);
    } catch {
      return <div className={styles.text}>{message.content}</div>;
    }
    return (
      <div className={styles.contactCard} onClick={() => navigate(`/contacts/${card.userId}`)}>
        <div className={styles.cardHeader}>
          {card.avatar ? (
            <img src={resolveFileUrl(card.avatar)} alt={card.nickname} className={styles.cardAvatar} />
          ) : (
            <div className={styles.cardAvatar}>{card.nickname?.charAt(0)}</div>
          )}
          <div className={styles.cardInfo}>
            <span className={styles.cardName}>{card.nickname}</span>
            <span className={styles.cardLabel}>{t('chat.contactCard')}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderFile = () => {
    const name = message.headers?.originalName || message.content.split('/').pop() || t('chat.file');
    const size = formatSize(message.headers?.size);
    return (
      <a href={resolveFileUrl(message.content)} target="_blank" rel="noreferrer" className={styles.fileCard}>
        <div className={styles.fileIcon}>
          <FileOutline />
        </div>
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{name}</span>
          <span className={styles.fileSize}>{size || t('chat.file')}</span>
        </div>
      </a>
    );
  };

  const renderVoice = () => {
    const duration = Number(message.headers?.duration) || 0;
    return <VoiceBubble src={message.content} duration={duration} seed={message.msgId || message.id || ''} />;
  };

  const renderContent = () => {
    switch (message.msgType) {
      case 'TEXT':
        return <div className={styles.text}>{renderTextWithMentions(message.content)}</div>;
      case 'IMAGE': {
        // 检查是否有附带文本（多模态消息）
        const textContent = message.headers?.textContent;
        return (
          <>
            <div className={styles.mediaWrapper}>
              <MediaImage
                src={resolveFileUrl(message.content)}
                alt={t('chat.imageVideo')}
                onClick={() => message.status !== 'sending' && onImageClick?.(resolveFileUrl(message.content))}
              />
              {message.status === 'sending' && (
                <div className={styles.uploadMask}>
                  <span>{message.progress ?? 0}%</span>
                </div>
              )}
              {message.status === 'failed' && (
                <div className={`${styles.uploadMask} ${styles.failedMask}`}>!</div>
              )}
            </div>
            {textContent && (
              <div className={styles.text}>{textContent}</div>
            )}
          </>
        );
      }
      case 'VIDEO':
        return (
          <div className={styles.videoWrapper}>
            <video
              src={resolveFileUrl(message.content)}
              controls
              className={styles.video}
              onPlay={(e) => (e.currentTarget.parentElement?.classList.add(styles.videoPlaying))}
              onPause={(e) => (e.currentTarget.parentElement?.classList.remove(styles.videoPlaying))}
            />
            <div className={styles.videoOverlay}>
              <div className={styles.playBtn}>▶</div>
            </div>
            {message.status === 'sending' && (
              <div className={styles.uploadMask}>
                <span>{message.progress ?? 0}%</span>
              </div>
            )}
          </div>
        );
      case 'FILE':
        return <div>{renderFile()}</div>;
      case 'VOICE':
        return <div>{renderVoice()}</div>;
      case 'CONTACT_CARD':
        return renderContactCard();
      default:
        return <div className={styles.text}>{renderTextWithMentions(message.content)}</div>;
    }
  };

  const mediaType = message.msgType === 'IMAGE' || message.msgType === 'VIDEO';
  const failed = message.status === 'failed';

  // 撤回消息：居中系统文案，不渲染气泡与头像
  if (message.msgType === 'RECALL') {
    return (
      <div className={styles.recallNotice}>
        {isSelf ? t('chat.youRecalled') : t('chat.otherRecalled')}
      </div>
    );
  }

  // 通话记录：居中记录条（G2）
  if (message.msgType === 'CALL') {
    const media = message.headers?.media === 'video' ? 'video' : 'audio';
    const status = message.headers?.callStatus || '';
    const text = formatCallRecordText(media, status, Number(message.headers?.duration || 0), t);
    const tone =
      status === 'MISSED' || status === 'REJECTED' ? styles.callRecordDanger
        : status === 'CANCELED' || status === 'FAILED' ? styles.callRecordMuted
        : '';
    return (
      <div className={styles.callRecord}>
        <span className={`${styles.callRecordChip} ${tone}`}>
          <span className={styles.callRecordIcon}>{media === 'video' ? '📹' : '📞'}</span>
          {text}
        </span>
      </div>
    );
  }

  const renderQuote = (standalone: boolean) => {
    if (!message.replyTo) return null;
    return (
      <div
        className={standalone ? styles.quoteBlockStandalone : styles.quoteBlock}
        onClick={(e) => {
          e.stopPropagation();
          onQuoteClick?.();
        }}
      >
        <span className={styles.quoteSender}>
          {replySenderName || t('chat.quoteOriginal')}
        </span>
        <span className={styles.quoteSummary}>{message.replyTo.summary}</span>
      </div>
    );
  };

  return (
    <div className={`${styles.container} ${isSelf ? styles.self : ''}`} data-msg-id={message.msgId}>
      <Avatar name={senderName} src={senderAvatar} onClick={onAvatarClick} onLongPress={onAvatarLongPress} />
      <div className={styles.bubbleWrapper}>
        {showSenderName && senderName && !isSelf && (
          <div className={styles.senderName}>{senderName}</div>
        )}
        {mediaType && renderQuote(true)}
        <div
          className={[
            styles.bubble,
            mediaType ? styles.mediaBubble : '',
            failed ? styles.failedBubble : '',
          ].filter(Boolean).join(' ')}
          onContextMenu={handleBubbleLongPress}
        >
          {!mediaType && renderQuote(false)}
          {renderContent()}
        </div>
        {isSelf && message.status === 'sending' && (
          <div className={styles.statusSending}>{t('chat.sending')}</div>
        )}
        {isSelf && message.status === 'failed' && (
          <div className={styles.statusFailed}>
            <span>{t('chat.sendFailed')}</span>
            <span className={styles.resendBtn} onClick={() => onResend?.()}>
              {t('chat.resend')}
            </span>
          </div>
        )}
        {!mediaType && failed && <div className={styles.failedMark}>!</div>}
      </div>
    </div>
  );
};

export default MessageBubble;
