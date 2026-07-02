// 颜色迁移至 semantic.ts (Phase 2.A)
// FilesPage — 文档预览（大厂视觉重写）
// 模型：claude-sonnet-4-6
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { ConversionZone } from '../components/ConversionZone'
import { TaskCard } from '../components/TaskCard'
import { PreviewModal } from '../components/PreviewModal'
import { InspectCompareModal } from '../inspect/InspectCompareModal'
import type { Task } from '../types'
import { FileTextIcon, SearchIcon, UploadIcon, ImageIcon, FileIcon } from '../design/icons'

export function FilesPage() {
  const { tasks, loading, selected, fetchTasks, select, refreshIfNeeded,
    inspectOpen, inspectSource, inspectCompare, inspectMode, closeInspect, openInspect, openTranslate } = useStore()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'office' | 'media' | 'text'>('all')

  const handleOpenTranslate = (t: Task) => {
    openInspect(t, null, { mode: 'translate' })
    openTranslate(t)
  }

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // 轮询转码
  useEffect(() => {
    const busy = tasks.some(t => t.convertStatus === 'pending' || t.convertStatus === 'processing' || t.convertStatus === 'retrying' || t.convertStatus === 'rasterizing')
    if (!busy) return
    let alive = true; let delay = 1500
    const tick = async () => {
      if (!alive) return
      await refreshIfNeeded()
      delay = Math.min(delay * 1.3, 4000)
      alive && (setTimeout(tick, delay))
    }
    setTimeout(tick, delay)
    return () => { alive = false }
  }, [tasks, refreshIfNeeded])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks.filter(t => {
      if (tab === 'office' && !['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'pdf'].includes(t.ext)) return false
      if (tab === 'media' && !['mp3', 'wav', 'm4a', 'aac', 'mp4', 'mov', 'mkv', 'flv', 'webm', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(t.ext)) return false
      if (tab === 'text' && !['txt', 'md'].includes(t.ext)) return false
      if (q && !t.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, query, tab])

  const download = (t: Task) => {
    const a = document.createElement('a'); a.href = t.originalUrl; a.download = t.name; a.click()
  }

  // 统计卡片
  const totalCount = tasks.length
  const convertingCount = tasks.filter(t => ['pending', 'processing', 'retrying', 'rasterizing'].includes(t.convertStatus || '')).length
  const readyCount = tasks.filter(t => t.status === 'ready').length
  const failedCount = tasks.filter(t => t.status === 'failed').length

  return (
    <div>
      {/* Page header */}
      <div className="oa-page-header">
        <h1 className="oa-page-title">
          <FileTextIcon size={24} style={{ color: 'var(--color-primary)' }} />
          文档预览
        </h1>
        <div className="oa-page-subtitle">
          上传文件 → 自动转码 → PDFium 渲染 + 文字层对齐 → 支持翻译/智检/OCR
        </div>
      </div>

      {/* Stats grid */}
      <div className="oa-stat-grid">
        <div className="oa-stat-card">
          <div className="oa-stat-label">总文件</div>
          <div className="oa-stat-value">{totalCount}</div>
          <div className="oa-stat-delta">当前可见：{filtered.length}</div>
        </div>
        <div className="oa-stat-card">
          <div className="oa-stat-label">待转码</div>
          <div className="oa-stat-value" style={{ color: 'var(--color-primary)' }}>{convertingCount}</div>
          <div className="oa-stat-delta">实时轮询</div>
        </div>
        <div className="oa-stat-card">
          <div className="oa-stat-label">已就绪</div>
          <div className="oa-stat-value" style={{ color: 'var(--color-success)' }}>{readyCount}</div>
          <div className="oa-stat-delta">可立即预览</div>
        </div>
        <div className="oa-stat-card">
          <div className="oa-stat-label">失败</div>
          <div className="oa-stat-value" style={{ color: failedCount > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>{failedCount}</div>
          <div className="oa-stat-delta">{failedCount > 0 ? '需要重试' : '全部正常'}</div>
        </div>
      </div>

      {/* 格式转换工作区 */}
      <ConversionZone />

      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16,
        background: '#fff', padding: 12, borderRadius: 8, border: '1px solid var(--color-border-light)',
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <SearchIcon size={16} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)',
          }} />
          <input
            type="search"
            placeholder="搜索文件名…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%', height: 32, paddingLeft: 36, paddingRight: 12,
              background: 'var(--color-bg-subtle)', border: '1px solid transparent', borderRadius: 6,
              outline: 'none', fontSize: 14,
            }}
            onFocus={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--color-primary)' }}
            onBlur={e => { e.currentTarget.style.background = 'var(--color-bg-subtle)'; e.currentTarget.style.borderColor = 'transparent' }}
          />
        </div>
        <div className="oa-tabs" style={{ borderBottom: 'none' }}>
          {([
            ['all', '全部', FileIcon],
            ['office', '文档', FileTextIcon],
            ['media', '媒体', ImageIcon],
            ['text', '文本', FileTextIcon],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              className={`oa-tab ${tab === k ? 'active' : ''}`}
              onClick={() => setTab(k)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          {filtered.length} 个文件
        </div>
      </div>

      {/* File grid */}
      {loading && !tasks.length ? (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="oa-skeleton" style={{ height: 200 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="oa-empty">
          <div className="oa-empty-icon"><UploadIcon size={48} /></div>
          <div className="oa-empty-title">暂无文件</div>
          <div className="oa-empty-desc">拖拽文件到上方，或等待后端扫描预置样本</div>
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(t => (
            <TaskCard key={t.id} task={t} onPreview={select} onInspect={openInspect} onTranslate={handleOpenTranslate} />
          ))}
        </div>
      )}

      {selected && <PreviewModal task={selected} onClose={() => select(null)} onDownload={download} />}
      <InspectCompareModal open={inspectOpen} source={inspectSource} compare={inspectCompare} onClose={closeInspect} defaultMode={inspectMode} />
    </div>
  )
}