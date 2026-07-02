import { useSyncExternalStore } from 'react';
import { chatStore } from './store';

export function HistorySidebar({ disabled }: { disabled: boolean }) {
  const { sessions, currentId } = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);

  return (
    <aside className="history">
      <button className="new-chat" disabled={disabled} onClick={() => chatStore.newSession()}>
        ＋ 新建对话
      </button>
      <div className="history-label">历史记录</div>
      <div className="history-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`history-item ${s.id === currentId ? 'active' : ''}`}
            onClick={() => !disabled && chatStore.switchSession(s.id)}
            title={s.title}
          >
            <div className="hi-main">
              <div className="hi-title">{s.title}</div>
              <div className="hi-meta">
                {s.turns.filter((t) => t.role === 'user').length} 轮 · {fmtTime(s.updatedAt)}
              </div>
            </div>
            <button
              className="hi-del"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('删除该会话？')) chatStore.deleteSession(s.id);
              }}
              title="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()}`;
}
