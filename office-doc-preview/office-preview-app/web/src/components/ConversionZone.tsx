// 颜色迁移至 semantic.ts (Phase 2.A)
// ConversionZone — 格式转换工作区：上传→转码→多格式预览（PDF / 图片+文字 / 复制文字）
// 模型：claude-sonnet-4-6
//
// 体验对标顶尖 SaaS（Notion / Dropbox / Canva）：
//   - 拖拽/点击上传，多文件并行队列，每文件独立进度
//   - 实时转换状态（排队→转码→文字层）
//   - 输出产物卡片：PDF 预览 + 图片页预览 + 文字可复制
//   - 上传历史列表（刚上传的文件独立展示）

import { useCallback, useRef, useState, useEffect } from 'react'
import { useStore } from '../store'
import type { Task } from '../types'
import { humanSize } from '../types'

// ============ 上传条目（前端状态，非 Task） ============
interface UploadItem {
  id: string          // 临时 ID
  name: string
  size: number
  ext: string
  pct: number         // 0..1
  status: 'uploading' | 'converting' | 'done' | 'failed'
  error?: string
  taskId?: string     // 后端 taskId，done 后回填
  task?: Task         // 后端完整 task
}

let _uploadSeq = 0

export function ConversionZone() {
  const fetchTasks = useStore(s => s.fetchTasks)
  const select = useStore(s => s.select)

  const [over, setOver] = useState(false)
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 轮询转码完成的任务
  useEffect(() => {
    const polling = queue.filter(q => q.status === 'converting' && q.taskId)
    if (!polling.length) return

    const timer = setInterval(async () => {
      await fetchTasks()
      const latest = useStore.getState().tasks
      setQueue(prev => prev.map(item => {
        if (item.status !== 'converting' || !item.taskId) return item
        const t = latest.find(x => x.id === item.taskId)
        if (!t) return item
        if (t.convertStatus === 'done') {
          return { ...item, status: 'done' as const, task: t, pct: 1 }
        }
        if (t.convertStatus === 'failed') {
          return { ...item, status: 'failed' as const, error: t.convertError || '转码失败', task: t }
        }
        // 更新进度
        const p = t.pagesTotal && t.pagesTotal > 0
          ? (t.pagesDone || 0) / t.pagesTotal
          : 0.5
        return { ...item, pct: Math.max(item.pct, p), task: t }
      }))
    }, 1500)

    return () => clearInterval(timer)
  }, [queue.some(q => q.status === 'converting')])

  // 移除已完成任务（自动清理）
  useEffect(() => {
    if (!queue.some(q => q.status === 'done')) return
    const timer = setTimeout(() => {
      setQueue(prev => prev.filter(q => q.status !== 'done'))
    }, 30000)
    return () => clearTimeout(timer)
  }, [queue])

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (!fileArr.length) return

    const items: UploadItem[] = fileArr.map(f => ({
      id: `up_${++_uploadSeq}`,
      name: f.name,
      size: f.size,
      ext: (f.name.split('.').pop() || '').toLowerCase(),
      pct: 0,
      status: 'uploading' as const,
    }))

    setQueue(prev => [...items, ...prev])

    // 逐文件上传
    for (let i = 0; i < fileArr.length; i++) {
      const f = fileArr[i]
      const item = items[i]

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.upload.onprogress = (e: ProgressEvent) => {
            if (e.lengthComputable) {
              setQueue(prev => prev.map(q => q.id === item.id ? { ...q, pct: e.loaded / e.total } : q))
            }
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText)
                item.taskId = data.task?.id
                resolve()
              } catch { reject(new Error('parse error')) }
            } else {
              let msg = `上传失败`
              try { msg = JSON.parse(xhr.responseText).error || msg } catch {}
              reject(new Error(msg))
            }
          }
          xhr.onerror = () => reject(new Error('网络错误'))
          const fd = new FormData()
          fd.append('file', f, f.name)
          xhr.open('POST', '/api/upload')
          xhr.send(fd)
        })

        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: item.taskId ? 'converting' as const : 'failed' as const, error: item.taskId ? undefined : '无 taskId' } : q
        ))
      } catch (e: any) {
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'failed' as const, error: e.message } : q
        ))
      }
    }

    await fetchTasks()
  }, [fetchTasks])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ============ 无队列时：拖拽上传区 ============
  if (!queue.length) {
    return (
      <div style={{ marginBottom: 24 }}>
        <div
          className={`upload-drop ${over ? 'over' : ''}`}
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setOver(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setOver(false) }}
          onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setOver(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.pptx,.xlsx,.doc,.ppt,.xls,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.txt,.md"
            onChange={e => { handleFiles(e.target.files || []); e.currentTarget.value = '' }}
          />
          <div className="upload-inner" style={{ padding: '32px 24px' }}>
            <div className="upload-emoji" style={{ fontSize: 36, marginBottom: 8 }}>🔄</div>
            <div className="upload-title" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              格式转换
            </div>
            <div className="upload-sub" style={{ maxWidth: 420, margin: '0 auto', lineHeight: 1.6, color: 'var(--color-text-tertiary)' }}>
              拖拽或点击上传 Office 文档 · PDF · 图片，自动转为 PDF + 高清图片，文字层精准对齐、可选中复制
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ============ 有队列时：上传/转换列表 ============
  const uploadingCount = queue.filter(q => q.status === 'uploading').length
  const convertingCount = queue.filter(q => q.status === 'converting').length
  const doneCount = queue.filter(q => q.status === 'done').length
  const failedCount = queue.filter(q => q.status === 'failed').length

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="oa-card" style={{ overflow: 'hidden' }}>
        {/* 头部 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
          borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>格式转换</span>
          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            {uploadingCount > 0 && <span style={{ color: 'var(--color-primary)' }}>上传 {uploadingCount}</span>}
            {convertingCount > 0 && <span style={{ color: 'var(--color-warning)' }}>转码 {convertingCount}</span>}
            {doneCount > 0 && <span style={{ color: 'var(--color-success)' }}>完成 {doneCount}</span>}
            {failedCount > 0 && <span style={{ color: 'var(--color-danger)' }}>失败 {failedCount}</span>}
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="oa-btn oa-btn-ghost oa-btn-sm"
            onClick={() => inputRef.current?.click()}
            title="继续添加文件"
          >
            ＋ 添加文件
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.pptx,.xlsx,.doc,.ppt,.xls,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.txt,.md"
            onChange={e => { handleFiles(e.target.files || []); e.currentTarget.value = '' }}
          />
        </div>

        {/* 列表 */}
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          {queue.map(item => (
            <QueueItem
              key={item.id}
              item={item}
              expanded={expanded.has(item.id)}
              onToggle={() => toggleExpand(item.id)}
              onPreview={(t) => select(t)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ 队列条目 ============
function QueueItem({ item, expanded, onToggle, onPreview }: {
  item: UploadItem; expanded: boolean; onToggle: () => void; onPreview: (t: Task) => void
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--color-bg-canvas)' }}>
      {/* 主行 */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
          cursor: 'pointer', transition: 'background 120ms',
          background: expanded ? 'var(--color-primary-bg)' : 'transparent',
        }}
      >
        {/* 状态图标 */}
        <StatusIcon status={item.status} />

        {/* 文件信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
            </span>
            <span style={{
              fontSize: 11, padding: '1px 6px', borderRadius: 3,
              background: 'var(--color-border-light)', color: 'var(--color-text-tertiary)', fontWeight: 500, flexShrink: 0,
            }}>
              {item.ext.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
            {humanSize(item.size)}
            {item.status === 'uploading' && ` · 上传 ${Math.round(item.pct * 100)}%`}
            {item.status === 'converting' && ` · 转码 ${Math.round(item.pct * 100)}%`}
            {item.status === 'done' && ` · 已完成`}
            {item.status === 'failed' && ` · ${item.error || '失败'}`}
          </div>
        </div>

        {/* 进度条 */}
        {(item.status === 'uploading' || item.status === 'converting') && (
          <div style={{ width: 120, flexShrink: 0 }}>
            <div style={{ width: '100%', height: 4, background: 'var(--color-border-light)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                width: `${item.pct * 100}%`, height: '100%',
                background: item.status === 'uploading' ? 'var(--color-primary)' : 'var(--color-success)',
                borderRadius: 2, transition: 'width 300ms ease',
              }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right', marginTop: 2 }}>
              {Math.round(item.pct * 100)}%
            </div>
          </div>
        )}

        {/* 操作 */}
        {item.status === 'done' && item.task && (
          <button
            className="oa-btn oa-btn-primary oa-btn-sm"
            onClick={e => { e.stopPropagation(); onPreview(item.task!) }}
          >
            预览
          </button>
        )}
        {item.status === 'done' && (
          <span style={{ fontSize: 20, color: expanded ? 'var(--color-primary)' : 'var(--color-text-placeholder)', transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : '' }}>
            ▾
          </span>
        )}
      </div>

      {/* 展开详情 */}
      {expanded && item.status === 'done' && item.task && (
        <ConversionDetail task={item.task} onPreview={onPreview} />
      )}
    </div>
  )
}

// ============ 状态图标 ============
function StatusIcon({ status }: { status: UploadItem['status'] }) {
  const style: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, flexShrink: 0,
  }
  switch (status) {
    case 'uploading':
      return <span style={{ ...style, background: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>⏳</span>
    case 'converting':
      return <span style={{ ...style, background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>⚙️</span>
    case 'done':
      return <span style={{ ...style, background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>✅</span>
    case 'failed':
      return <span style={{ ...style, background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>❌</span>
  }
}

// ============ 转码完成详情（产物卡片） ============
function ConversionDetail({ task, onPreview }: { task: Task; onPreview: (t: Task) => void }) {
  const pages = task.pages || []
  const hasPdf = task.previewUrl && (task.previewExt === 'pdf' || task.ext === 'pdf')
  const hasImages = pages.length > 0

  return (
    <div style={{ padding: '0 20px 16px 20px', background: 'var(--color-bg)' }}>
      {/* 产物摘要 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        {/* PDF 产物 */}
        <div style={{
          background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: 8,
          padding: 16, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>📕</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>PDF 预览</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              {task.previewSize ? humanSize(task.previewSize) : task.ext === 'pdf' ? humanSize(task.size) : '转码产物'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button
                className="oa-btn oa-btn-primary oa-btn-sm"
                onClick={() => onPreview(task)}
              >
                在线预览
              </button>
              {task.previewUrl && (
                <a
                  className="oa-btn oa-btn-default oa-btn-sm"
                  href={task.previewUrl}
                  download={task.name.replace(/\.[^.]+$/, '') + '.pdf'}
                  style={{ textDecoration: 'none' }}
                >
                  下载 PDF
                </a>
              )}
            </div>
          </div>
        </div>

        {/* 图片产物 */}
        {hasImages && (
          <div style={{
            background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: 8,
            padding: 16, display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 24 }}>🖼️</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>图片+文字</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                {pages.length} 页 · 文字可选中复制
              </div>
            </div>
          </div>
        )}

        {/* 统计 */}
        <div style={{
          background: '#fff', border: '1px solid var(--color-border-light)', borderRadius: 8,
          padding: 16, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>📊</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>文件信息</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              {humanSize(task.size)} · {task.ext.toUpperCase()}
              {task.convertDurationMs && ` · ${(task.convertDurationMs / 1000).toFixed(1)}s 转码`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 4 }}>
              文字层 {task.textDone || pages.length}/{pages.length} 页 · 可扫描 · 可翻译
            </div>
          </div>
        </div>
      </div>

      {/* 页面缩略图预览 */}
      {pages.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            页面预览（{pages.length} 页）
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
            {pages.map(p => (
              <div
                key={p.page}
                style={{
                  flexShrink: 0, width: 120, border: '1px solid var(--color-border-light)',
                  borderRadius: 6, overflow: 'hidden', background: 'var(--color-bg-subtle)',
                  cursor: 'pointer',
                }}
                onClick={() => onPreview(task)}
                title={`第 ${p.page} 页`}
              >
                <img
                  src={p.url}
                  alt={`第 ${p.page} 页`}
                  loading="lazy"
                  style={{ width: '100%', height: 160, objectFit: 'contain', display: 'block' }}
                />
                <div style={{
                  textAlign: 'center', padding: '4px 8px', fontSize: 11,
                  color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border-light)',
                }}>
                  第 {p.page} 页
                  {p.textUrl && ' · 文字✓'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 复制文字 */}
      {pages.some(p => p.textUrl) && (
        <button
          className="oa-btn oa-btn-default oa-btn-sm"
          onClick={async () => {
            const texts: string[] = []
            for (const p of pages) {
              if (!p.textUrl) continue
              try {
                const r = await fetch(p.textUrl)
                if (r.ok) {
                  const html = await r.text()
                  const div = document.createElement('div')
                  div.innerHTML = html
                  texts.push((div.textContent || '').trim())
                }
              } catch {}
            }
            if (texts.length) {
              await navigator.clipboard.writeText(texts.join('\n\n'))
              alert(`已复制 ${texts.length} 页文字到剪贴板`)
            }
          }}
          style={{ marginTop: 12 }}
        >
          📋 复制全部文字
        </button>
      )}
    </div>
  )
}