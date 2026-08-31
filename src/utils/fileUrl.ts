/**
 * 将相对文件路径（如 /api/files/local/xxx）拼上后端域名，
 * 解决 Capacitor 打包后 app 内无法访问后端文件的问题。
 * 绝对 URL（http/https/data: 开头）直接返回。
 */
export const resolveFileUrl = (url: string): string => {
  if (!url || url.startsWith('http') || url.startsWith('data:')) return url;
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  if (!apiBase) return url;
  const origin = apiBase.replace(/\/api\/?$/, '');
  return origin + url;
};
