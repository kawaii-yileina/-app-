import { create } from 'zustand';
import { authApi } from '../api';
import type { User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: User) => void;
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

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  user: initialUser,
  isAuthenticated: !!initialToken,
  setAuth: (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },
  logout: () => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
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
      console.error('Failed to restore session:', e);
    }
  },
}));
