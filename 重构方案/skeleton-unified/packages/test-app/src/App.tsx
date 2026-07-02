import { useState, useEffect } from 'react'
import { ConfigProvider, Typography, Divider } from 'antd'
import { Skeleton } from '@skeleton/renderer-react'
import ProductCard from './components/ProductCard'
import UserProfileCard from './components/UserProfileCard'
import ArticleListItem from './components/ArticleListItem'
import productCardBones from './bones/product-card.bones.json'
import userProfileCardBones from './bones/user-profile-card.bones.json'
import articleListItemBones from './bones/article-list-item.bones.json'

const { Title } = Typography

const products = [
  {
    id: 1, name: 'MacBook Pro 16 英寸', price: 19999, originalPrice: 22999,
    rating: 5, reviews: 2341, category: '电脑', inStock: true,
    image: 'https://picsum.photos/seed/mac/400/300',
  },
  {
    id: 2, name: 'Sony WH-1000XM5 降噪耳机', price: 1999, originalPrice: 2599,
    rating: 4, reviews: 876, category: '耳机', inStock: true,
    image: 'https://picsum.photos/seed/sony/400/300',
  },
  {
    id: 3, name: 'iPad Air M2', price: 4799, originalPrice: 5299,
    rating: 4, reviews: 543, category: '平板', inStock: false,
    image: 'https://picsum.photos/seed/ipad/400/300',
  },
]

const users = [
  {
    id: 1, name: '陈晓明', username: 'chenxm', email: 'chen@example.com',
    bio: '专注前端工程化 10 年，写过骨架屏、翻译扩展，热爱开源。', followers: 1420,
    following: 312, posts: 89, tags: ['React', 'TypeScript', 'Vite'], verified: true,
  },
  {
    id: 2, name: 'Sarah Lee', username: 'sarahlee', email: 'sarah@example.com',
    bio: 'Full-stack developer at Anthropic. Building AI-powered developer tools.', followers: 3200,
    following: 150, posts: 214, tags: ['AI', 'Next.js', 'Python'], verified: false,
  },
]

const articles = [
  {
    id: 1,
    title: '2024 年前端骨架屏实现方案全对比：CSS、SVG、Canvas 三种方式深度测评',
    summary: '骨架屏是提升页面感知性能的关键手段。本文对比了三种主流实现方案的优缺点，并给出各场景下的最优选择建议，附完整代码示例。',
    author: { name: '陈晓明', avatar: 'https://i.pravatar.cc/100?u=1' },
    publishedAt: '2024-06-15',
    readTime: 8, tags: ['骨架屏', '性能优化', '前端工程化'],
    likes: 312, comments: 47, views: 8920,
    coverImage: 'https://picsum.photos/seed/skeleton/280/200',
  },
  {
    id: 2,
    title: 'React Fiber 内部机制揭秘：从 reconciler 到 commit 的完整链路',
    summary: '本文深入 React 18 源码，逐步拆解 Fiber 架构的核心设计，包括优先级调度、时间切片、并发渲染等关键特性的内部实现原理。',
    author: { name: 'Sarah Lee', avatar: 'https://i.pravatar.cc/100?u=2' },
    publishedAt: '2024-06-10',
    readTime: 15, tags: ['React', 'Fiber', '源码解析'],
    likes: 891, comments: 132, views: 23450,
    coverImage: 'https://picsum.photos/seed/react/280/200',
  },
  {
    id: 3,
    title: 'Vite 5 插件开发完全指南：从零实现一个骨架屏自动生成插件',
    summary: '通过实战项目讲解 Vite 插件 API 的核心用法，包括 transform、load、configureServer 钩子，最终实现一个可发布的 npm 插件。',
    author: { name: '陈晓明', avatar: 'https://i.pravatar.cc/100?u=1' },
    publishedAt: '2024-06-05',
    readTime: 12, tags: ['Vite', '插件开发', 'Node.js'],
    likes: 445, comments: 63, views: 12800,
  },
]

function App() {
  const [loading, setLoading] = useState(true)
  useEffect(() => { const t = setTimeout(() => setLoading(false), 2000); return () => clearTimeout(t) }, [])

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1677ff' } }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

        {/* 说明 */}
        <div style={{ marginBottom: 32, padding: 16, background: '#f0f5ff', borderRadius: 8, border: '1px solid #d6e4ff' }}>
          <Title level={4} style={{ margin: 0, marginBottom: 8 }}>🧪 Skeleton 插件测试页</Title>
          <p style={{ margin: 0, color: '#555' }}>
            打开 Chrome 扩展 → 点击页面元素 → 骨架名称 &amp; 文件路径自动填写（来自 React Fiber <code>_debugSource</code>）→ 点「写入项目」。
          </p>
        </div>

        {/* 商品卡片 */}
        <Title level={3}>商品卡片 <code style={{ fontSize: 14 }}>ProductCard</code></Title>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 48 }}>
          {products.map(p => (
            <Skeleton key={p.id} loading={loading} bones={productCardBones} animation="pulse" name={`product-card-${p.id}`}>
              <ProductCard product={p} onAddToCart={id => console.log('cart', id)} />
            </Skeleton>
          ))}
        </div>

        <Divider />

        {/* 用户卡片 */}
        <Title level={3}>用户卡片 <code style={{ fontSize: 14 }}>UserProfileCard</code></Title>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 48 }}>
          {users.map(u => (
            <Skeleton key={u.id} loading={loading} bones={userProfileCardBones} animation="pulse" name={`user-${u.id}`}>
              <UserProfileCard user={u} onFollow={id => console.log('follow', id)} />
            </Skeleton>
          ))}
        </div>

        <Divider />

        {/* 文章列表 */}
        <Title level={3}>文章列表 <code style={{ fontSize: 14 }}>ArticleListItem</code></Title>
        <div style={{ maxWidth: 720 }}>
          {articles.map(a => (
            <Skeleton key={a.id} loading={loading} bones={articleListItemBones} animation="pulse" name={`article-${a.id}`}>
              <ArticleListItem article={a} />
            </Skeleton>
          ))}
        </div>

      </div>
    </ConfigProvider>
  )
}

export default App
