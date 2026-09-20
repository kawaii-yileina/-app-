import type { CSSProperties } from 'react';

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

/** 麦克风（切换到语音输入） */
export const MicIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);

/** 键盘（切换到文字输入） */
export const KeyboardIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M8.5 17h7" />
  </svg>
);

/** 播放三角 */
export const PlayIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M8 5.2v13.6L19 12z" />
  </svg>
);

/** 暂停 */
export const PauseIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="7" y="5" width="3.4" height="14" rx="1" />
    <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
  </svg>
);

/** 复制 */
export const CopyIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="11" height="11" rx="2.4" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15" />
  </svg>
);

/** 引用（双引号） */
export const QuoteIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M9.6 5.4C6.5 6.9 4.6 9.5 4.6 12.9c0 3.1 1.8 5.1 4.2 5.1 2 0 3.5-1.5 3.5-3.4 0-1.9-1.3-3.2-3.1-3.2-.3 0-.6 0-.8.1.4-1.7 1.9-3.2 3.9-4.1zM18.7 5.4c-3.1 1.5-5 4.1-5 7.5 0 3.1 1.8 5.1 4.2 5.1 2 0 3.5-1.5 3.5-3.4 0-1.9-1.3-3.2-3.1-3.2-.3 0-.6 0-.8.1.4-1.7 1.9-3.2 3.9-4.1z" />
  </svg>
);

/** 转发（向右箭头 + 竖线） */
export const ForwardIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M13 5.5 20 12l-7 6.5v-4H8.5a4.5 4.5 0 0 0-4.5 4.5c0-6 3-9.5 8-9.5h1z" />
  </svg>
);

/** 撤回（逆时针箭头） */
export const RecallIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 10h9.5a6 6 0 0 1 0 12H9" />
    <path d="M8 6 4 10l4 4" />
  </svg>
);

/** 保存 / 下载 */
export const SaveIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 4v10" />
    <path d="M8 10.5 12 14.5l4-4" />
    <path d="M5 17v1.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
);

/** 删除（垃圾桶） */
export const DeleteIcon = ({ className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 7h16" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    <path d="M10.5 11v5.5M13.5 11v5.5" />
  </svg>
);
