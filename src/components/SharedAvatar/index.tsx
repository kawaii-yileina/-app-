import { useCachedMediaUrl } from '../../hooks/useCachedMediaUrl';
import { avatarTint } from '../../utils/avatarColor';
import styles from './index.module.css';

interface Props {
  name?: string;
  src?: string;
  size?: number;
  className?: string;
}

const SharedAvatar = ({ name, src, size = 40, className }: Props) => {
  const sizeStyle = { width: size, height: size, fontSize: size * 0.4 };
  const { url, failed, onError } = useCachedMediaUrl(src, true);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name || 'avatar'}
        className={`${styles.imgAvatar} ${className || ''}`}
        style={sizeStyle}
        onError={onError}
      />
    );
  }

  return (
    <div
      className={`${styles.avatar} ${className || ''}`}
      style={{ ...sizeStyle, background: avatarTint(name || '') }}
    >
      {name?.charAt(0) || '?'}
    </div>
  );
};

export default SharedAvatar;
