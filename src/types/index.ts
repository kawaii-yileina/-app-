export interface User {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  signature: string;
}

export interface Friend extends User {}

export interface SearchUser extends User {
  isFriend: boolean;
  requestStatus: number;
}

export interface FriendRequestItem {
  id: string;
  fromId: string;
  toId: string;
  nickname: string;
  avatar: string;
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  avatar: string;
  ownerId: string;
}

export interface GroupMember {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  role: number;
  joinedAt: string;
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
}

export interface Conversation {
  id: string;
  userId: string;
  targetId: string;
  chatType: number;
  lastMsgContent: string;
  lastMsgTime: string;
  unreadCount: number;
}

export interface ChatMessage {
  type: string;
  from: string;
  to: string;
  group: boolean;
  content: string;
  id?: string;
  headers?: Record<string, string>;
}

export interface LoginResponse {
  token: string;
  userId: string;
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
