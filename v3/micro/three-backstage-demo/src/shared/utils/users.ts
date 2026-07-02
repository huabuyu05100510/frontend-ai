/**
 * 系统 A：用户数据 Mock（持久化在 localStorage）
 */
export interface SystemAUser {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

const STORAGE_KEY = 'system-a-users';

const seed: SystemAUser[] = [
  { id: 'u001', name: '张三', email: 'zhangsan@example.com', department: '产品部', role: '产品经理', status: 'active', createdAt: '2024-01-15' },
  { id: 'u002', name: '李四', email: 'lisi@example.com', department: '研发部', role: '前端工程师', status: 'active', createdAt: '2024-03-20' },
  { id: 'u003', name: '王五', email: 'wangwu@example.com', department: '运营部', role: '运营专员', status: 'active', createdAt: '2024-05-10' },
  { id: 'u004', name: '赵六', email: 'zhaoliu@example.com', department: '市场部', role: '市场经理', status: 'disabled', createdAt: '2024-06-01' },
  { id: 'u005', name: '钱七', email: 'qianqi@example.com', department: '研发部', role: '后端工程师', status: 'active', createdAt: '2024-08-12' },
];

export function loadUsers(): SystemAUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    saveUsers(seed);
    return seed;
  } catch {
    return seed;
  }
}

export function saveUsers(users: SystemAUser[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
}

export function addUser(user: Omit<SystemAUser, 'id' | 'createdAt'>): SystemAUser {
  const users = loadUsers();
  const newUser: SystemAUser = {
    ...user,
    id: `u${String(users.length + 1).padStart(3, '0')}`,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  users.push(newUser);
  saveUsers(users);
  return newUser;
}

export function updateUser(id: string, patch: Partial<SystemAUser>): boolean {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx < 0) return false;
  users[idx] = { ...users[idx], ...patch };
  saveUsers(users);
  return true;
}

export function deleteUser(id: string): boolean {
  const users = loadUsers();
  const filtered = users.filter(u => u.id !== id);
  if (filtered.length === users.length) return false;
  saveUsers(filtered);
  return true;
}