import { useState } from 'react'
import { CollaborativeEditor } from './components/CollaborativeEditor'
import type { UserInfo } from './types'

// 预设用户颜色方案（对比度高，视觉友好）
const PRESET_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626',
  '#ea580c', '#16a34a', '#0891b2', '#4f46e5',
]

function getDefaultRoomId() {
  return new URLSearchParams(window.location.search).get('room') ?? 'demo-room-01'
}

function SetupModal({ onJoin }: { onJoin: (user: UserInfo, room: string) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)])
  const [roomId, setRoomId] = useState(getDefaultRoomId)
  const [error, setError] = useState('')

  const handleJoin = () => {
    if (!name.trim()) { setError('请输入你的名字'); return }
    if (!roomId.trim()) { setError('请输入房间号'); return }
    onJoin(
      { id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: name.trim(), color },
      roomId.trim()
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-logo">⚡</div>
          <h1 className="modal-title">协同文档编辑器</h1>
          <p className="modal-subtitle">基于 CRDT（Yjs）+ WebRTC 的企业级实时协同方案</p>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">你的名字</label>
            <input
              className="form-input"
              placeholder="输入名字（会显示在他人编辑器中）"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">选择颜色</label>
            <div className="color-picker">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  className={`color-dot ${color === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              房间号
              <span className="label-hint">相同房间号的用户可协同编辑</span>
            </label>
            <input
              className="form-input"
              placeholder="输入房间号（如 project-alpha）"
              value={roomId}
              onChange={e => { setRoomId(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
            />
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={handleJoin}>
            进入协同编辑 →
          </button>
          <p className="modal-tip">
            💡 打开多个浏览器 Tab，使用相同房间号即可体验多人实时协同
          </p>
        </div>

        {/* 技术亮点卡片 */}
        <div className="feature-cards">
          {[
            { icon: '🔀', title: 'CRDT 无冲突', desc: 'Yjs 算法，多人同时编辑零冲突' },
            { icon: '👁️', title: '实时光标', desc: 'Awareness 协议，感知他人位置' },
            { icon: '🔒', title: '段落指示', desc: '实时显示他人正在编辑的段落' },
            { icon: '📶', title: '离线恢复', desc: '断线后操作自动同步，不丢内容' },
          ].map(f => (
            <div key={f.title} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<{ user: UserInfo; roomId: string } | null>(null)

  if (!session) {
    return <SetupModal onJoin={(user, roomId) => setSession({ user, roomId })} />
  }

  return <CollaborativeEditor user={session.user} roomId={session.roomId} />
}
