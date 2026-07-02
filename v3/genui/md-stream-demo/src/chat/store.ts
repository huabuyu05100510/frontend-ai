import { type Session, type Turn, uid } from './types';

/**
 * ChatStore —— 多轮会话状态 + localStorage 持久化历史。
 * 外部 store，配合 useSyncExternalStore 订阅。
 */
const LS_KEY = 'a2ui.md.sessions.v1';

interface Snapshot {
  sessions: Session[];
  currentId: string | null;
}

type Listener = () => void;

class ChatStore {
  private snap: Snapshot;
  private listeners = new Set<Listener>();

  constructor() {
    this.snap = this.load();
    if (this.snap.sessions.length === 0) {
      const s = this.blank();
      this.snap = { sessions: [s], currentId: s.id };
    } else if (!this.snap.currentId) {
      this.snap.currentId = this.snap.sessions[0].id;
    }
  }

  private blank(): Session {
    return { id: uid(), title: '新的对话', turns: [], updatedAt: Date.now() };
  }

  getSnapshot = (): Snapshot => this.snap;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  current(): Session | undefined {
    return this.snap.sessions.find((s) => s.id === this.snap.currentId);
  }

  newSession() {
    const s = this.blank();
    this.commit({ sessions: [s, ...this.snap.sessions], currentId: s.id });
  }

  switchSession(id: string) {
    this.commit({ ...this.snap, currentId: id });
  }

  deleteSession(id: string) {
    const sessions = this.snap.sessions.filter((s) => s.id !== id);
    let currentId = this.snap.currentId;
    if (currentId === id) currentId = sessions[0]?.id ?? null;
    if (sessions.length === 0) {
      const s = this.blank();
      this.commit({ sessions: [s], currentId: s.id });
    } else {
      this.commit({ sessions, currentId });
    }
  }

  addTurn(role: Turn['role'], content: string) {
    const cur = this.current();
    if (!cur) return;
    const turn: Turn = { id: uid(), role, content, ts: Date.now() };
    const isFirstUser = role === 'user' && cur.turns.filter((t) => t.role === 'user').length === 0;
    const updated: Session = {
      ...cur,
      turns: [...cur.turns, turn],
      title: isFirstUser ? truncate(content) : cur.title,
      updatedAt: Date.now(),
    };
    this.replaceSession(updated, true);
  }

  /** 删除某轮（用于重新生成场景，可选） */
  removeLastAssistant() {
    const cur = this.current();
    if (!cur) return;
    const turns = [...cur.turns];
    if (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop();
    this.replaceSession({ ...cur, turns }, true);
  }

  private replaceSession(updated: Session, bump: boolean) {
    const sessions = this.snap.sessions.map((s) => (s.id === updated.id ? updated : s));
    // 把活跃会话移到最前
    if (bump) sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    this.commit({ ...this.snap, sessions });
  }

  private commit(next: Snapshot) {
    this.snap = next;
    this.persist();
    this.listeners.forEach((l) => l());
  }

  private persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.snap));
    } catch {
      /* ignore quota */
    }
  }

  private load(): Snapshot {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw) as Snapshot;
    } catch {
      /* ignore */
    }
    return { sessions: [], currentId: null };
  }
}

function truncate(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 20 ? t.slice(0, 20) + '…' : t || '新的对话';
}

export const chatStore = new ChatStore();
