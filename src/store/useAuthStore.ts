import { create } from 'zustand';
import { authApi } from '../api';
import { clearChatCache, disposeChatCache } from '../services/chatCache';
import { useChatStore } from './useChatStore';
import type { User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (token: string, refreshToken: string, user: User) => void;
  updateTokens: (token: string, refreshToken?: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  restoreUser: (token: string) => Promise<void>;
}

const readUser = (): User | null => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
};

const initialToken = localStorage.getItem('token');
const initialUser = initialToken ? readUser() : null;

export const useAuthStore = create<AuthState>((set, get) => ({
  token: initialToken,
  user: initialUser,
  isAuthenticated: !!initialToken,
  setAuth: (token, refreshToken, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },
  updateTokens: (token, refreshToken) => {
    localStorage.setItem('token', token);
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken);
    }
    set({ token, isAuthenticated: true });
  },
  logout: () => {
    const refreshToken = localStorage.getItem('refreshToken') || undefined;
    const userId = get().user?.userId;
    authApi.logout(refreshToken).catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    resetChatState();
    disposeChatCache();
    if (userId) void clearChatCache(String(userId));
    set({ token: null, user: null, isAuthenticated: false });
  },
  updateUser: (userData) =>
    set((state) => {
      if (!state.user) return state;
      const updated = { ...state.user, ...userData };
      localStorage.setItem('user', JSON.stringify(updated));
      return { user: updated };
    }),
  restoreUser: async (token) => {
    try {
      const res = await authApi.getMe();
      if (res.code === 200 && res.data) {
        localStorage.setItem('user', JSON.stringify(res.data));
        set({ token, user: res.data, isAuthenticated: true });
      }
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        // token 失效：清理本地登录态，避免携带无效 token 反复请求
        const userId = get().user?.userId;
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        resetChatState();
        disposeChatCache();
        if (userId) void clearChatCache(String(userId));
        set({ token: null, user: null, isAuthenticated: false });
      } else {
        // 网络不可用：保留登录态与本地缓存，离线仍可查看近期消息
        console.warn('Failed to restore session, keep local state:', e);
      }
    }
  },
}));

/** 清空会话态：登出/失效时调用，避免切换账号后残留消息与同步游标（游标只升不降会压制新账号补拉） */
function resetChatState() {
  useChatStore.setState({
    conversations: [],
    messages: {},
    activeConversation: null,
    syncCursors: {},
    typing: {},
    pendingTimers: new Map(),
    conversationDeletedAt: {},
    hydrated: false,
    initialLoading: true,
  });
}

/**
 * 静默续期成功后由 api 层派发，更新 store 中的 token。
 * 通过事件解耦，避免 api 层反向依赖 store 造成循环引用。
 */
window.addEventListener('auth:token-refreshed', ((event: CustomEvent<{ token: string; refreshToken?: string }>) => {
  useAuthStore.getState().updateTokens(event.detail.token, event.detail.refreshToken);
}) as EventListener);
