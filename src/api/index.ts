import axios from 'axios';
import type { Result, LoginResponse, User, Friend, Group, Message, MessageSyncResult, Conversation, GroupMember, AiConversation, UserAiConfig, SearchUser, FriendRequestItem, EmojiSticker } from '../types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── 静默续期（single-flight，避免并发 401 触发多次刷新）───

let refreshPromise: Promise<string> | null = null;

const isAuthEndpoint = (url: string) =>
  url.includes('/auth/refresh') || url.includes('/auth/login') || url.includes('/auth/register');

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw new Error('no refresh token');
      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/refresh`,
        { refreshToken },
        { timeout: 15000 }
      );
      const data = res.data?.data;
      if (!data?.token) throw new Error(res.data?.message || 'refresh failed');
      localStorage.setItem('token', data.token);
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      window.dispatchEvent(new CustomEvent('auth:token-refreshed', {
        detail: { token: data.token, refreshToken: data.refreshToken },
      }));
      return data.token as string;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function clearAuthAndRedirect() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const url: string = original?.url || '';

    if (status === 401 && original && !original._retry && !isAuthEndpoint(url)) {
      original._retry = true;
      try {
        const newToken = await refreshAccessToken();
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        clearAuthAndRedirect();
        return Promise.reject(refreshError);
      }
    }

    // 401 且无法刷新（如 refresh 已失效）：清理并回登录页
    if (status === 401) {
      clearAuthAndRedirect();
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post<any, Result<LoginResponse>>('/auth/login', { username, password }),
  loginByCode: (email: string, code: string) =>
    api.post<any, Result<LoginResponse>>('/auth/login/code', { email, code }),
  register: (username: string, password: string, nickname?: string, email?: string, code?: string) =>
    api.post<any, Result<LoginResponse>>('/auth/register', { username, password, nickname, email, code }),
  sendCode: (email: string, scene: 'register' | 'login' | 'reset_password') =>
    api.post<any, Result<void>>('/auth/send-code', { email, scene }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    api.post<any, Result<void>>('/auth/reset-password', { email, code, newPassword }),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post<any, Result<void>>('/auth/change-password', { oldPassword, newPassword }),
  deleteAccount: (password: string) =>
    api.post<any, Result<void>>('/auth/delete-account', { password }),
  getMe: () => api.get<any, Result<User>>('/auth/me'),
  updateProfile: (data: { nickname?: string; signature?: string; avatar?: string }) =>
    api.put<any, Result<User>>('/auth/me', data),
  logout: (refreshToken?: string) => api.post<any, Result<void>>('/auth/logout', { refreshToken }),
};

export const contactApi = {
  getFriends: () => api.get<any, Result<Friend[]>>('/contacts/friends'),
  addFriend: (friendId: string) => api.post<any, Result<void>>('/contacts/friends', { friendId }),
  removeFriend: (friendId: string) => api.delete<any, Result<void>>(`/contacts/friends/${friendId}`),
  sendRequest: (friendId: string) => api.post<any, Result<void>>('/contacts/requests', { friendId }),
  getReceivedRequests: () => api.get<any, Result<FriendRequestItem[]>>('/contacts/requests/received'),
  getSentRequests: () => api.get<any, Result<FriendRequestItem[]>>('/contacts/requests/sent'),
  acceptRequest: (id: string) => api.post<any, Result<void>>(`/contacts/requests/${id}/accept`),
  rejectRequest: (id: string) => api.post<any, Result<void>>(`/contacts/requests/${id}/reject`),
  getGroups: () => api.get<any, Result<Group[]>>('/contacts/groups'),
  getGroup: (groupId: string) => api.get<any, Result<Group>>(`/contacts/groups/${groupId}`),
  createGroup: (name: string) => api.post<any, Result<Group>>('/contacts/groups', { name }),
  updateGroup: (groupId: string, name: string) =>
    api.put<any, Result<void>>(`/contacts/groups/${groupId}`, { name }),
  getGroupMembers: (groupId: string) =>
    api.get<any, Result<GroupMember[]>>(`/contacts/groups/${groupId}/members`),
  addGroupMember: (groupId: string, userId: string) =>
    api.post<any, Result<void>>(`/contacts/groups/${groupId}/members`, { userId }),
  removeGroupMember: (groupId: string, memberId: string) =>
    api.delete<any, Result<void>>(`/contacts/groups/${groupId}/members/${memberId}`),
  transferGroupOwner: (groupId: string, newOwnerId: string) =>
    api.post<any, Result<void>>(`/contacts/groups/${groupId}/transfer`, { newOwnerId }),
  quitGroup: (groupId: string) =>
    api.delete<any, Result<void>>(`/contacts/groups/${groupId}/quit`),
  checkGroupMember: (groupId: string, userId: string) =>
    api.get<any, Result<boolean>>(`/contacts/groups/${groupId}/check`, { params: { userId } }),
};

export const userApi = {
  search: (keyword: string) =>
    api.get<any, Result<SearchUser[]>>('/users/search', { params: { keyword } }),
  getById: (id: string) => api.get<any, Result<SearchUser>>(`/users/${id}`),
};

export const messageApi = {
  getHistory: (targetId: string, chatType: number, page = 1, size = 20) =>    api.get<any, Result<Message[]>>('/messages/history', {
      params: { targetId, chatType, page, size },
    }),
  getConversations: () => api.get<any, Result<Conversation[]>>('/messages/conversations'),
  /** 会话增量同步：拉取 seq > sinceSeq 的消息，用于断线重连 / 多端补拉 */
  syncMessages: (targetId: string, chatType: number, sinceSeq = 0, limit = 200) =>
    api.get<any, Result<MessageSyncResult>>('/messages/sync', {
      params: { targetId, chatType, sinceSeq, limit },
    }),
  markAsRead: (targetId: string, chatType: number) =>
    api.put<any, Result<void>>('/messages/conversations/read', { targetId, chatType }),
  recallMessage: (msgId: string) =>
    api.post<any, Result<void>>('/messages/recall', { msgId }),
  deleteConversation: (targetId: string, chatType: number) =>
    api.delete<any, Result<void>>(`/messages/conversations/${targetId}/${chatType}`),
  getUnreadCounts: () => api.get<any, Result<Record<string, number>>>('/messages/unread'),
  getOnlineFriends: () => api.get<any, Result<string[]>>('/messages/online/friends'),
  isUserOnline: (userId: string) => api.get<any, Result<boolean>>(`/messages/online/${userId}`),
};

export const fileApi = {
  upload: async (
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ url: string; key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<any, Result<{ url: string; key: string }>>('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    return response.data;
  },
};

export const emojiApi = {
  list: () => api.get<any, Result<EmojiSticker[]>>('/emoji/stickers'),
  add: (url: string) => api.post<any, Result<EmojiSticker>>('/emoji/stickers', { url }),
  remove: (id: string) => api.delete<any, Result<void>>(`/emoji/stickers/${id}`),
};

export const aiApi = {  chat: (message: string, sessionId?: string) =>
    api.post<any, Result<string>>('/ai/chat', { message, sessionId }),
    getSessions: () => api.get<any, Result<{ sessionId: string; title: string | null }[]>>('/ai/sessions'),
  getSessionHistory: (sessionId: string) =>
    api.get<any, Result<AiConversation[]>>(`/ai/sessions/${sessionId}/history`),
  deleteSession: (sessionId: string) =>
    api.delete<any, Result<void>>(`/ai/sessions/${sessionId}`),
  getConfig: () => api.get<any, Result<UserAiConfig>>('/ai/config'),
  saveConfig: (config: UserAiConfig) =>
    api.put<any, Result<UserAiConfig>>('/ai/config', config),
};

export default api;
