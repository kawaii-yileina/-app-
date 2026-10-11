import type { TFunction } from 'i18next';
import type { Message, ReplyInfo, MentionInfo } from '../types';
import { RECALL_PREVIEW } from '../types';

/**
 * 会话「最后一条消息」的展示文案。
 * 撤回消息在会话预览里存的是占位符（与后端 ChatConstants.RECALL_PREVIEW_* 一致），
 * 需统一翻译；否则会话列表、转发选择页等会直接渲染出 __RECALL_OTHER__ 这类占位符。
 */
export function formatConversationPreview(content: string, t: TFunction): string {
  if (content === RECALL_PREVIEW.SELF) return t('chat.youRecalled');
  if (content === RECALL_PREVIEW.OTHER) return t('chat.otherRecalled');
  return content;
}

/**
 * 生成会话列表的最后一条消息摘要文案。
 * 供 WS 接收（App.tsx）与本地发送（ChatWindow）共用，避免两处逻辑不一致。
 */
export function truncatePreview(
  content: string,
  type: string,
  headers?: Record<string, string>
): string {
  switch (type) {
    case 'IMAGE':
      return '[图片]';
    case 'VIDEO':
      return '[视频]';
    case 'VOICE':
      return `[语音] ${Math.round(Number(headers?.duration) || 0)}"`;
    case 'CONTACT_CARD':
      return '[个人名片]';
    case 'FILE': {
      const name = headers?.originalName || '';
      const text = `[文件] ${name}`;
      return text.length > 30 ? text.substring(0, 30) + '...' : text;
    }
    default:
      return content.length > 30 ? content.substring(0, 30) + '...' : content;
  }
}

/** 待发送的转发/名片载荷（经 sessionStorage 在页面间传递） */
export interface PendingOutgoing {
  msgType: string;
  content: string;
  headers?: Record<string, string>;
  preview?: string;
  /** 发送成功后的提示文案（i18n 结果），无则不提示 */
  successToast?: string;
}

export const PENDING_OUTGOING_KEY = 'pending_outgoing';
export const PENDING_FORWARD_KEY = 'pending_forward';

/** WS headers 中承载引用回复信息的键名（与后端 ChatConstants.HEADER_REPLY_TO 一致） */
export const REPLY_HEADER_KEY = 'replyTo';

/** 由被引用消息构造引用信息 */
export function buildReplyInfo(message: Message): ReplyInfo {
  return {
    msgId: message.msgId,
    senderId: message.senderId,
    msgType: message.msgType,
    summary: truncatePreview(message.content, message.msgType, message.headers),
  };
}

/** 解析后端返回 / headers 中的引用信息（JSON 字符串） */
export function parseReplyInfo(raw?: string | null): ReplyInfo | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as ReplyInfo;
    return parsed && parsed.msgId ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 解析后端返回的历史消息 headers（JSON 字符串，含 duration/originalName 等展示型字段） */
export function parseHeaders(raw?: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** WS headers 中承载 @提及信息的键名（与后端 ChatConstants.HEADER_MENTIONS 一致） */
export const MENTIONS_HEADER_KEY = 'mentions';
/** @所有人的特殊成员 id（与后端 ChatConstants.MENTION_ALL 一致） */
export const MENTION_ALL = 'all';

/** 解析 @提及信息（JSON 数组字符串） */
export function parseMentions(raw?: string | null): MentionInfo[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as MentionInfo[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 规范化后端返回的消息（历史 / 增量同步）：replyTo / mentions / headers 为 JSON 字符串，统一解析为对象。
 * 历史加载与 /messages/sync 补拉共用，避免两处逻辑不一致。
 */
export function normalizeServerMessage(msg: Message): Message {
  const rawReply = msg.replyTo as unknown;
  const rawMentions = msg.mentions as unknown;
  const rawHeaders = msg.headers as unknown;
  return {
    ...msg,
    // 后端 Long 统一序列化为字符串（避免精度丢失），seq 需转 number 供排序/游标使用
    seq: toFiniteNumber(msg.seq),
    replyTo: typeof rawReply === 'string' ? parseReplyInfo(rawReply) : msg.replyTo,
    mentions: typeof rawMentions === 'string' ? parseMentions(rawMentions) : msg.mentions,
    headers: typeof rawHeaders === 'string' ? parseHeaders(rawHeaders) : msg.headers,
  };
}

/** 尽力把未知值转成有限数字，否则返回 undefined（避免 NaN 污染排序） */
export function toFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 仅保留正文中仍存在的 @提及（用户可能删掉了 token 文本） */
export function pruneMentions(text: string, mentions: MentionInfo[]): MentionInfo[] {
  return mentions.filter((m) => text.includes(`@${m.nickname}`));
}

/** 服务端保留 header：转发/构造新消息时必须剔除，避免旧值（如过期 seq）污染下行 */
const RESERVED_HEADERS = ['seq', 'ack', 'serverMsgId', 'delivered'];

/** 从一条消息构造转发载荷（剥离仅本地使用的字段与服务端保留 header） */
export function buildForwardPayload(message: Message): PendingOutgoing {
  const headers = message.headers ? { ...message.headers } : undefined;
  if (headers) {
    for (const key of RESERVED_HEADERS) delete headers[key];
  }
  return {
    msgType: message.msgType,
    content: message.content,
    headers,
    preview: truncatePreview(message.content, message.msgType, message.headers),
  };
}
