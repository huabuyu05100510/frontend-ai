import { Card, Avatar, Button, Divider, Statistic, Space, Tag } from 'antd'
import { UserOutlined, MailOutlined, GithubOutlined, TwitterOutlined } from '@ant-design/icons'

interface UserProfile {
  id: number
  name: string
  username: string
  email: string
  bio: string
  avatar?: string
  followers: number
  following: number
  posts: number
  tags: string[]
  verified: boolean
}

interface UserProfileCardProps {
  user: UserProfile
  onFollow?: (id: number) => void
}

function UserProfileCard({ user, onFollow }: UserProfileCardProps) {
  return (
    <div data-ske-name="user-profile-card" style={{ width: 320 }}>
      <Card styles={{ body: { padding: 24 } }}>
        {/* 头部：头像 + 基本信息 */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
          <Avatar
            size={72}
            src={user.avatar}
            icon={<UserOutlined />}
            style={{ flexShrink: 0, background: '#1677ff' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{user.name}</span>
              {user.verified && <Tag color="blue" style={{ margin: 0 }}>认证</Tag>}
            </div>
            <div style={{ color: '#888', fontSize: 13, marginBottom: 4 }}>@{user.username}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#888', fontSize: 12 }}>
              <MailOutlined />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </span>
            </div>
          </div>
        </div>

        {/* Bio */}
        <p style={{ color: '#555', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          {user.bio}
        </p>

        {/* 标签 */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
          {user.tags.map(tag => (
            <Tag key={tag} color="geekblue">{tag}</Tag>
          ))}
        </div>

        <Divider style={{ margin: '0 0 16px' }} />

        {/* 统计 */}
        <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
          <Statistic title="帖子" value={user.posts} valueStyle={{ fontSize: 20, textAlign: 'center' }} />
          <Statistic title="粉丝" value={user.followers} valueStyle={{ fontSize: 20, textAlign: 'center' }} />
          <Statistic title="关注" value={user.following} valueStyle={{ fontSize: 20, textAlign: 'center' }} />
        </div>

        {/* 操作 */}
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button type="primary" style={{ flex: 1 }} onClick={() => onFollow?.(user.id)}>
            关注
          </Button>
          <Button icon={<GithubOutlined />} />
          <Button icon={<TwitterOutlined />} />
        </Space>
      </Card>
    </div>
  )
}

export default UserProfileCard
