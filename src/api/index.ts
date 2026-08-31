import axios from 'axios';
import type { Result, LoginResponse, User, Friend, Group, Message, Conversation, GroupMember, AiConversation, UserAiConfig, SearchUser, FriendRequestItem } from '../types';

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

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post<any, Result<LoginResponse>>('/auth/login', { username, password }),
  register: (username: string, password: string, nickname?: string) =>
    api.post<any, Result<LoginResponse>>('/auth/register', { username, password, nickname }),
  getMe: () => api.get<any, Result<User>>('/auth/me'),
  updateProfile: (data: { nickname?: string; signature?: string; avatar?: string }) =>
    api.put<any, Result<User>>('/auth/me', data),
  logout: () => api.post<any, Result<void>>('/auth/logout'),
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
  markAsRead: (targetId: string, chatType: number) =>
    api.put<any, Result<void>>('/messages/conversations/read', { targetId, chatType }),
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

export const aiApi = {
  chat: (message: string, sessionId?: string) =>
    api.post<any, Result<string>>('/ai/chat', { message, sessionId }),
  getSessions: () => api.get<any, Result<string[]>>('/ai/sessions'),
  getSessionHistory: (sessionId: string) =>
    api.get<any, Result<AiConversation[]>>(`/ai/sessions/${sessionId}/history`),
  deleteSession: (sessionId: string) =>
    api.delete<any, Result<void>>(`/ai/sessions/${sessionId}`),
  getConfig: () => api.get<any, Result<UserAiConfig>>('/ai/config'),
  saveConfig: (config: UserAiConfig) =>
    api.put<any, Result<UserAiConfig>>('/ai/config', config),
};

export default api;
