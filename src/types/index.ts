export interface User {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  signature: string;
}

export interface Friend extends User {
  /** 好友是否已注销账号 */
  deleted?: boolean;
}

export interface SearchUser extends User {
  isFriend: boolean;
  requestStatus: number;
}

export interface SearchCategory<T> {
  total: number;
  items: T[];
}

export interface SearchContactItem {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  signature: string;
  isFriend: number;
}

export interface SearchGroupItem {
  id: string;
  name: string;
  avatar: string;
  ownerId: string;
}

export interface SearchMemberItem {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  groupId: string;
  groupName: string;
  role: number;
}

export interface SearchMessageItem {
  msgId: string;
  seq: string | number;
  targetId: string;
  chatType: number;
  senderId: string;
  senderName: string;
  groupName: string | null;
  content: string;
  createdAt: string;
}

export interface SearchResponse {
  contacts: SearchCategory<SearchContactItem>;
  groups: SearchCategory<SearchGroupItem>;
  members: SearchCategory<SearchMemberItem>;
  messages: SearchCategory<SearchMessageItem>;
}

export interface FriendRequestItem {
  id: string;
  fromId: string;
  toId: string;
  nickname: string;
  avatar: string;
  createdAt: string;
}

export interface GroupMemberAvatar {
  nickname: string;
  avatar: string;
}

export interface Group {
  id: string;
  name: string;
  avatar: string;
  ownerId: string;
  memberAvatars?: GroupMemberAvatar[];
}

export interface GroupMember {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  role: number;
  joinedAt: string;
  /** 成员是否已注销账号 */
  deleted?: boolean;
}

export interface ReplyInfo {
  msgId: string;
  senderId: string;
  msgType: string;
  summary: string;
}

export interface Message {
  id: string;
  msgId: string;
  senderId: string;
  receiverId: string;
  chatType: number;
  msgType: string;
  content: string;
  createdAt: string;
  headers?: Record<string, string>;
  status?: 'sending' | 'sent' | 'failed';
  progress?: number;
  /** 会话内权威序号：历史/增量同步与持久化投递路径（跨节点/离线，经 headers.seq）带回；本节点直投无，由 /sync 补拉回填 */
  seq?: number;
  /** 引用回复信息（历史消息由后端 replyTo JSON 解析而来） */
  replyTo?: ReplyInfo;
  /** @提及成员（历史消息由后端 mentions JSON 解析而来） */
  mentions?: MentionInfo[];
}

/** 会话增量同步接口返回体（GET /messages/sync） */
export interface MessageSyncResult {
  messages: Message[];
  /** 本批最大 seq，作为下次 sinceSeq 游标 */
  lastSeq: number;
  hasMore: boolean;
}

export interface MentionInfo {
  userId: string;
  nickname: string;
}

export interface Conversation {
  id: string;
  userId: string;
  targetId: string;
  chatType: number;
  lastMsgContent: string;
  lastMsgTime: string;
  lastMsgTimeMs?: number;
  lastMsgId?: string;
  unreadCount: number;
  /** 是否有人 @ 我（1 为是） */
  mentioned?: number;
}

export interface ChatMessage {
  type: string;
  from: string;
  to: string;
  group: boolean;
  content: string;
  id?: string;
  /** 毫秒时间戳（加密 AAD 绑定，服务端下发/上行均带） */
  timestamp?: number;
  headers?: Record<string, string>;
}

/** SYSTEM 消息事件类型（与后端 SystemEvent 枚举一致） */
export const SystemEventType = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  FRIEND_REQUEST: 'friend_request',
  FRIEND_ACCEPT: 'friend_accept',
  FRIEND_REJECT: 'friend_reject',
  GROUP_ADD: 'group_add',
  GROUP_KICK: 'group_kick',
  GROUP_QUIT: 'group_quit',
  GROUP_TRANSFER: 'group_transfer',
  GROUP_RENAME: 'group_rename',
  GROUP_ADMIN_SET: 'group_admin_set',
  GROUP_ADMIN_UNSET: 'group_admin_unset',
  MESSAGE_RECALL: 'message_recall',
  CONVERSATION_CHANGED: 'conversation_changed',
  SESSION_KICKED: 'session_kicked',
  ACCOUNT_BANNED: 'account_banned',
  RATE_LIMITED: 'rate_limited',
} as const;

/** 表情包收藏项 */
export interface EmojiSticker {
  id: string;
  userId: string;
  url: string;
  createdAt: string;
}

/** 会话列表撤回预览占位（与后端 ChatConstants.RECALL_PREVIEW_* 一致） */
export const RECALL_PREVIEW = {
  SELF: '__RECALL_SELF__',
  OTHER: '__RECALL_OTHER__',
} as const;

/**
 * 从 SYSTEM 消息 content 解析事件类型（冒号前第一段）。
 * content 格式：eventType:arg1:arg2:...
 */
export function parseSystemEventType(content: string): string {
  if (!content) return '';
  const idx = content.indexOf(':');
  return idx > 0 ? content.substring(0, idx) : content;
}

export interface LoginResponse {
  token: string;
  /** 长效刷新令牌，用于 access token 过期后静默续期 */
  refreshToken: string;
  userId: string;
  username?: string;
  nickname: string;
  avatar: string;
}

export interface Result<T> {
  code: number;
  message: string;
  data: T;
}

export interface AiConversation {
  id: string;
  userId: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface UserAiConfig {
  id?: string;
  userId?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  enabled: number;
}

export const AI_ASSISTANT = {
  ID: 0,
  NAME: 'AI 助手',
  AVATAR: '',
} as const;

export const SYSTEM_ACCOUNT = {
  ID: -1,
  NAME: '系统通知',
  AVATAR: '',
} as const;
