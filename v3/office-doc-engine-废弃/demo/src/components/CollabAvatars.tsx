import React from 'react'
import type { CollabUser } from '../core/types'

interface CollabAvatarsProps {
  users: CollabUser[]
  onToggleUser: (userId: string) => void
  activeIds: Set<string>
}

export const CollabAvatars: React.FC<CollabAvatarsProps> = ({ users, onToggleUser, activeIds }) => (
  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
    {users.map(user => (
      <div
        key={user.id}
        onClick={() => onToggleUser(user.id)}
        title={`${user.name} — ${activeIds.has(user.id) ? '已激活' : '点击激活模拟'}`}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: activeIds.has(user.id) ? user.color : '#45475a',
          color: activeIds.has(user.id) ? '#1e1e2e' : '#6c7086',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.2s',
          border: `2px solid ${activeIds.has(user.id) ? user.color : 'transparent'}`,
          userSelect: 'none',
        }}
      >
        {user.name[0]}
      </div>
    ))}
  </div>
)