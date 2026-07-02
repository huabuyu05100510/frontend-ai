export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface Session {
  id: string;
  title: string;
  turns: Turn[];
  updatedAt: number;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
