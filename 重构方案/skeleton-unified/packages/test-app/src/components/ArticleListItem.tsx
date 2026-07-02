import { Avatar, Tag, Space, Button, Divider } from 'antd'
import { LikeOutlined, MessageOutlined, ShareAltOutlined, EyeOutlined } from '@ant-design/icons'

interface Article {
  id: number
  title: string
  summary: string
  author: { name: string; avatar?: string }
  publishedAt: string
  readTime: number
  tags: string[]
  likes: number
  comments: number
  views: number
  coverImage?: string
}

interface ArticleListItemProps {
  article: Article
}

function ArticleListItem({ article }: ArticleListItemProps) {
  return (
    <div data-ske-name="article-list-item" style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 16 }}>
        {/* 主内容 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 标签 */}
          <Space size={4} wrap style={{ marginBottom: 8 }}>
            {article.tags.map(tag => (
              <Tag key={tag} style={{ margin: 0 }}>{tag}</Tag>
            ))}
          </Space>

          {/* 标题 */}
          <h2 style={{
            fontSize: 18, fontWeight: 700, lineHeight: 1.4,
            margin: '0 0 8px', cursor: 'pointer',
            overflow: 'hidden', display: '-webkit-box',
            WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
          }}>
            {article.title}
          </h2>

          {/* 摘要 */}
          <p style={{
            fontSize: 14, color: '#666', lineHeight: 1.6, margin: '0 0 12px',
            overflow: 'hidden', display: '-webkit-box',
            WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
          }}>
            {article.summary}
          </p>

          {/* 作者 + 时间 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Avatar size={24} src={article.author.avatar}>{article.author.name[0]}</Avatar>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{article.author.name}</span>
            <span style={{ color: '#999', fontSize: 12 }}>·</span>
            <span style={{ color: '#999', fontSize: 12 }}>{article.publishedAt}</span>
            <span style={{ color: '#999', fontSize: 12 }}>·</span>
            <span style={{ color: '#999', fontSize: 12 }}>阅读约 {article.readTime} 分钟</span>
          </div>

          {/* 互动栏 */}
          <Space size={16}>
            <Button type="text" size="small" icon={<LikeOutlined />} style={{ color: '#888', padding: 0 }}>
              {article.likes}
            </Button>
            <Button type="text" size="small" icon={<MessageOutlined />} style={{ color: '#888', padding: 0 }}>
              {article.comments}
            </Button>
            <Button type="text" size="small" icon={<EyeOutlined />} style={{ color: '#888', padding: 0 }}>
              {article.views}
            </Button>
            <Button type="text" size="small" icon={<ShareAltOutlined />} style={{ color: '#888', padding: 0 }} />
          </Space>
        </div>

        {/* 封面图 */}
        {article.coverImage && (
          <div style={{
            width: 140, height: 100, flexShrink: 0,
            borderRadius: 8, overflow: 'hidden', background: '#f0f0f0',
          }}>
            <img
              src={article.coverImage}
              alt={article.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
      </div>
      <Divider style={{ margin: '0' }} />
    </div>
  )
}

export default ArticleListItem
