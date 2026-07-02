import { create } from 'zustand';

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  permissions: string[];
  login: (user: User, token: string, permissions: string[]) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  permissions: [],

  login: (user, token, permissions) => set({ user, token, permissions }),
  logout: () => set({ user: null, token: null, permissions: [] }),
  isLoggedIn: () => get().user !== null,
}));