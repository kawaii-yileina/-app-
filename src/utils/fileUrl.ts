/**
 * 将相对文件路径（如 /api/files/local/xxx）拼上后端域名，并追加 JWT 鉴权：
 * - 后端文件接口已要求登录，<img>/<video>/<audio> 无法携带 Authorization 头，
 *   故统一用 JWT 双通道中的 ?token= 形式附加（见后端 JwtAuthenticationFilter）。
 * - 绝对 URL（http/https/data:/blob:）直接返回。
 * - 仅对本站文件接口（/api/files/）追加 token，避免把令牌带到外部地址。
 */
export const resolveFileUrl = (url: string): string => {
  if (!url || url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const origin = apiBase.replace(/\/api\/?$/, '');
  const resolved = origin + url;
  if (!url.startsWith('/api/files/')) return resolved;
  const token = localStorage.getItem('token');
  if (!token) return resolved;
  return `${resolved}${resolved.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
};

/**
 * 判断消息里的媒体地址是否允许自动加载（<img>/<video> 自动发起请求）。
 * 仅允许本站文件接口与本地数据源：外部 http(s) 地址会被用于消息轰炸/追踪
 * （受害者客户端无操作即向攻击者服务器发起请求，见渗透报告 R4-02），
 * 这类地址一律不自动加载，由界面降级为链接展示。
 */
export const isInlineMediaSrc = (url: string): boolean => {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (url.startsWith('/api/files/')) return true;
  return url.startsWith(`${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/api\/?$/, '')}/api/files/`);
};
