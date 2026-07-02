import { create } from 'zustand';

export interface User {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
}

interface AuthState {
  user: User | null;
  permissions: string[];
  login: (user: User, permissions: string[]) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  permissions: [],

  login: (user, permissions) => set({ user, permissions }),

  logout: () => set({ user: null, permissions: [] }),

  isLoggedIn: () => get().user !== null,

  hasPermission: (permission) => get().permissions.includes(permission),

  hasAnyPermission: (permissions) =>
    permissions.some(p => get().permissions.includes(p)),
}));