import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileOutline, SoundOutline } from 'antd-mobile-icons';
import { ActionSheet } from 'antd-mobile';
import { resolveFileUrl } from '../../utils/fileUrl';
import { downloadFile } from '../../utils/download';
import type { Message } from '../../types';
import styles from './index.module.css';

interface Props {
  message: Message;
  isSelf: boolean;
  senderName?: string;
  senderAvatar?: string;
  showSenderName?: boolean;
  onAvatarClick?: () => void;
  onImageClick?: (src: string) => void;
  onLongPress?: () => void;
}

interface ContactCardData {
  userId: string;
  nickname: string;
  avatar: string;
}

const Avatar = ({ name, src, onClick }: { name?: string; src?: string; onClick?: () => void }) => {
  const resolvedSrc = src ? resolveFileUrl(src) : undefined;
  const content = resolvedSrc ? (
    <img src={resolvedSrc} alt={name || 'avatar'} className={styles.imgAvatar} />
  ) : (
    <div className={styles.avatar}>{name?.charAt(0) || '?'}</div>
  );

  if (onClick) {
    return <div className={styles.avatarClickable} onClick={onClick}>{content}</div>;
  }
  return content;
};

const formatSize = (sizeStr?: string) => {
  const size = Number(sizeStr);
  if (!size || isNaN(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const MessageBubble = ({ message, isSelf, senderName, senderAvatar, showSenderName, onAvatarClick, onImageClick, onLongPress }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 媒体消息长按：保存/删除菜单（阻止冒泡，避免同时触发气泡菜单）
  const handleMediaLongPress = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ActionSheet.show({
      actions: [
        {
          key: 'save',
          text: t('chat.saveMedia'),
          onClick: () => downloadFile(message.content),
        },
        {
          key: 'delete',
          text: t('common.delete'),
          danger: true,
          onClick: () => onLongPress?.(),
        },
      ],
    });
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
    return (
      <div className={styles.voiceBubble}>
        <SoundOutline className={styles.voiceIcon} />
        <span className={styles.voiceDuration}>{Math.round(duration)}"</span>
        <audio src={resolveFileUrl(message.content)} className={styles.voiceAudio} controls preload="none" />
      </div>
    );
  };

  const renderContent = () => {
    switch (message.msgType) {
      case 'TEXT':
        return <div className={styles.text}>{message.content}</div>;
      case 'IMAGE': {
        // 检查是否有附带文本（多模态消息）
        const textContent = message.headers?.textContent;
        return (
          <>
            <div className={styles.mediaWrapper} onContextMenu={handleMediaLongPress}>
              <img
                src={resolveFileUrl(message.content)}
                alt={t('chat.imageVideo')}
                className={styles.image}
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
          <div className={styles.videoWrapper} onContextMenu={handleMediaLongPress}>
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
        return <div onContextMenu={handleMediaLongPress}>{renderFile()}</div>;
      case 'VOICE':
        return <div onContextMenu={handleMediaLongPress}>{renderVoice()}</div>;
      case 'CONTACT_CARD':
        return renderContactCard();
      default:
        return <div className={styles.text}>{message.content}</div>;
    }
  };

  const mediaType = message.msgType === 'IMAGE' || message.msgType === 'VIDEO';
  const failed = message.status === 'failed';

  return (
    <div className={`${styles.container} ${isSelf ? styles.self : ''}`}>
      <Avatar name={senderName} src={senderAvatar} onClick={onAvatarClick} />
      <div className={styles.bubbleWrapper}>
        {showSenderName && senderName && !isSelf && (
          <div className={styles.senderName}>{senderName}</div>
        )}
        <div
          className={[
            styles.bubble,
            mediaType ? styles.mediaBubble : '',
            failed ? styles.failedBubble : '',
          ].filter(Boolean).join(' ')}
          onContextMenu={handleBubbleLongPress}
        >
          {renderContent()}
        </div>
        {failed && <div className={styles.failedMark}>!</div>}
      </div>
    </div>
  );
};

export default MessageBubble;
