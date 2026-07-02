import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { UploadDrop } from './components/UploadDrop'
import { TaskCard } from './components/TaskCard'
import { PreviewModal } from './components/PreviewModal'
import type { Task } from './types'

export default function App() {
  const { tasks, loading, selected, fetchTasks, select, refreshIfNeeded } = useStore()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'office' | 'media' | 'text'>('all')

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // 有任务在转码时轮询（指数退避）
  useEffect(() => {
    const busy = tasks.some(t => t.convertStatus === 'pending' || t.convertStatus === 'processing' || t.convertStatus === 'retrying')
    if (!busy) return
    let alive = true
    let delay = 1500
    const tick = async () => {
      if (!alive) return
      await refreshIfNeeded()
      delay = Math.min(delay * 1.3, 4000)
      timer = setTimeout(tick, delay)
    }
    let timer = setTimeout(tick, delay)
    return () => { alive = false; clearTimeout(timer) }
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
    const a = document.createElement('a')
    a.href = t.originalUrl
    a.download = t.name
    a.click()
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo">📄</span>
          <div>
            <div className="brand-title">Office 文档智能预览</div>
            <div className="brand-sub">智能解析 · 高保真还原 · 极致性能</div>
          </div>
        </div>
        <div className="tabs">
          {([['all', '全部'], ['office', '文档'], ['media', '媒体'], ['text', '文本']] as const).map(([k, label]) => (
            <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </header>

      <main className="app-main">
        <UploadDrop />

        <div className="list-toolbar">
          <input
            className="search"
            placeholder="搜索文件名…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <span className="list-count">{filtered.length} 个文件</span>
        </div>

        {loading && !tasks.length ? (
          <div className="grid">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card skeleton" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-emoji">📭</div>
            <div>暂无文件</div>
            <div className="hint">拖拽文件到上方，或等待后端扫描预置样本</div>
          </div>
        ) : (
          <div className="grid">
            {filtered.map(t => (
              <TaskCard key={t.id} task={t} onPreview={select} />
            ))}
          </div>
        )}
      </main>

      {selected && (
        <PreviewModal task={selected} onClose={() => select(null)} onDownload={download} />
      )}
    </div>
  )
}
