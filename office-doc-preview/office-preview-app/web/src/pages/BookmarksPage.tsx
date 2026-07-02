// 颜色迁移至 semantic.ts (Phase 2.A)
// BookmarksPage — 收藏夹（任务星标列表）
// 模型：claude-sonnet-4-6
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { BookmarkIcon, FileIcon, StarIcon } from '../design/icons'
import type { Task } from '../types'

BookmarksPage.displayName = 'BookmarksPage'

export function BookmarksPage() {
  const navigate = useNavigate()
  const bookmarks = useStore(s => s.bookmarks)
  const tasks = useStore(s => s.tasks)
  const toggleBookmark = useStore(s => s.toggleBookmark)

  const bookmarkedTasks = useMemo<Task[]>(() => {
    return tasks.filter(t => bookmarks.has(t.id))
  }, [tasks, bookmarks])

  return (
    <div>
      {/* Page header */}
      <div className="oa-page-header">
        <h1 className="oa-page-title">
          <BookmarkIcon size={24} style={{ color: 'var(--color-primary)' }} />
          收藏夹
        </h1>
        <div className="oa-page-subtitle">
          已收藏 {bookmarkedTasks.length} 个任务 · 点击卡片快速预览
        </div>
      </div>

      {bookmarkedTasks.length === 0 ? (
        <div className="oa-empty">
          <div className="oa-empty-icon"><StarIcon size={48} /></div>
          <div className="oa-empty-title">暂无收藏</div>
          <div className="oa-empty-desc">在文档预览中点击星标即可收藏</div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {bookmarkedTasks.map(t => (
            <div
              key={t.id}
              data-testid={`bookmark-card-${t.id}`}
              className="oa-card"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/files?task=${t.id}`)}
            >
              <div className="oa-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileIcon size={16} />
                  <span className="oa-card-title" title={t.name}>{t.name}</span>
                </div>
                <button
                  type="button"
                  aria-label="取消收藏"
                  onClick={(e) => { e.stopPropagation(); toggleBookmark(t.id) }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--color-warning)', padding: 4,
                  }}
                >
                  <StarIcon size={14} />
                </button>
              </div>
              <div className="oa-card-body" style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {(t.ext || '').toUpperCase()} · {(t.size / 1024).toFixed(1)} KB
              </div>
              <div className="oa-card-footer">
                <span className="oa-badge oa-badge-ok">已收藏</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {new Date(t.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BookmarksPage