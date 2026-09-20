const AVATAR_TINTS = ['#FFD9DF', '#D6EFFF', '#FFE5D9', '#D8F3E7', '#E9E1FF', '#FFE9F0'];

/**
 * 按名称/ID 生成确定性柔和底色，保证同一个人在所有页面颜色一致。
 * 供 SharedAvatar、会话列表、消息气泡等所有头像统一使用。
 */
export function avatarTint(key: string): string {
  let h = 0;
  const s = key || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
