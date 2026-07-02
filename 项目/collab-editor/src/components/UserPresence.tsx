import type { AwarenessState, ConnectionStatus, UserInfo } from '../types'

interface UserPresenceProps {
  currentUser: UserInfo
  peers: AwarenessState[]
  status: ConnectionStatus
  roomId: string
}

const STATUS_CONFIG = {
  connected: { label: '已连接', color: '#10b981', dot: '●' },
  connecting: { label: '连接中', color: '#f59e0b', dot: '◌' },
  disconnected: { label: '已断开', color: '#ef4444', dot: '○' },
}

function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <div
      className="user-avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
      title={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function UserPresence({ currentUser, peers, status, roomId }: UserPresenceProps) {
  const cfg = STATUS_CONFIG[status]
  const allUsers = [{ user: currentUser, activeParagraphPos: undefined }, ...peers]

  const copyRoomLink = () => {
    const url = `${window.location.origin}?room=${roomId}`
    navigator.clipboard.writeText(url).catch(() => {})
  }

  return (
    <aside className="presence-panel">
      {/* 连接状态 */}
      <div className="presence-section">
        <div className="presence-label">连接状态</div>
        <div className="status-badge" style={{ color: cfg.color }}>
          <span className="status-dot">{cfg.dot}</span>
          {cfg.label}
        </div>
      </div>

      <div className="divider" />

      {/* 房间信息 */}
      <div className="presence-section">
        <div className="presence-label">当前房间</div>
        <div className="room-info">
          <span className="room-id">{roomId}</span>
          <button className="copy-btn" onClick={copyRoomLink} title="复制房间链接">
            ⎘
          </button>
        </div>
        <div className="room-hint">打开新 Tab 输入相同房间号即可协同</div>
      </div>

      <div className="divider" />

      {/* 在线用户 */}
      <div className="presence-section">
        <div className="presence-label">
          在线用户 <span className="user-count">{allUsers.length}</span>
        </div>
        <ul className="user-list">
          {allUsers.map(({ user }, i) => (
            <li key={user.id} className="user-item">
              <Avatar name={user.name} color={user.color} />
              <div className="user-info">
                <span className="user-name">
                  {user.name}
                  {i === 0 && <span className="you-badge">你</span>}
                </span>
                <span className="user-status" style={{ color: user.color }}>
                  ● 在线
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="divider" />

      {/* 技术说明（面试展示用） */}
      <div className="presence-section tech-notes">
        <div className="presence-label">技术方案</div>
        <ul className="tech-list">
          <li>
            <span className="tech-tag">CRDT</span> Yjs 无冲突合并
          </li>
          <li>
            <span className="tech-tag">P2P</span> WebRTC 直连传输
          </li>
          <li>
            <span className="tech-tag">感知</span> Awareness 协议
          </li>
          <li>
            <span className="tech-tag">指示</span> 段落活动装饰器
          </li>
        </ul>
      </div>
    </aside>
  )
}
