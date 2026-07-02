// 颜色迁移至 semantic.ts (Phase 2.A)
// FormatConvertPage — 格式转换（AI 能力之一）
// 模型：claude-sonnet-4-6
//
// 三模式（xf-workspace 布局）：
//   1. 格式转换 — 源文件 → 转 PDF + 图片 → 产物预览 + 下载 + 复制文字
//   2. 对比预览 — 双栏：左原文件 / 右转换产物，验证还原度
//   3. 文字标注 — 图片+文字层，划选文字 → 标注/批注/复制
//
// 端点：
//   POST /api/convert            → ensure 转换产物（pdfUrl + pages）
//   GET  /api/annotate/:taskId   → 标注列表
//   POST /api/annotate           → 创建标注
//   DELETE /api/annotate/:id     → 删除标注
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useStore } from '../store'
import type { Task, PageImage } from '../types'
import { humanSize } from '../types'
import { LayersIcon, FileTextIcon, DownloadIcon, CopyIcon, TrashIcon } from '../design/icons'

type Mode = 'convert' | 'compare' | 'annotate'
type TargetFmt = 'pdf' | 'images'

const SUBMENU: { key: Mode; label: string }[] = [
  { key: 'convert', label: '格式转换' },
  { key: 'compare', label: '对比预览' },
  { key: 'annotate', label: '文字标注' },
]

const CONVERTIBLE_EXT = ['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'gif']

interface ConvertResult {
  taskId: string
  status: string
  target: TargetFmt
  pdfUrl?: string | null
  pages?: PageImage[]
  originalUrl?: string
  progress?: { pagesTotal: number; pagesDone: number; pct: number }
  error?: string
  meta?: { pagesCount: number; pdfSize: number; convertMs: number; engine: string; ext: string; strategy: string }
}

interface Annotation {
  id: string
  taskId: string
  page: number
  text: string
  note?: string
  color?: string
  createdAt: number
}

export function FormatConvertPage() {
  const [mode, setMode] = useState<Mode>('convert')
  const tasks = useStore(s => s.tasks)
  const convertible = useMemo(
    () => tasks.filter(t => CONVERTIBLE_EXT.includes(t.ext.toLowerCase())),
    [tasks],
  )

  return (
    <div className="xf-workspace" data-testid="format-convert-page">
      <div className="xf-submenu">
        {SUBMENU.map(s => (
          <button
            key={s.key}
            className={`xf-submenu-item${mode === s.key ? ' active' : ''}`}
            onClick={() => setMode(s.key)}
            data-testid={`fc-tab-${s.key}`}
          >{s.label}</button>
        ))}
      </div>
      <div className="xf-content">
        {mode === 'convert' && <ConvertMode tasks={convertible} />}
        {mode === 'compare' && <CompareMode tasks={convertible} />}
        {mode === 'annotate' && <AnnotateMode tasks={convertible} />}
      </div>
    </div>
  )
}

/* ============ 共用：源文件选择器 ============ */
function SourcePicker({ tasks, value, onChange, testId }: {
  tasks: Task[]
  value: string | null
  onChange: (taskId: string) => void
  testId?: string
}) {
  return (
    <select
      className="xf-select"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      data-testid={testId}
      style={{ minWidth: 280 }}
    >
      <option value="" disabled>选择源文件…</option>
      {tasks.map(t => (
        <option key={t.id} value={t.id}>
          {t.name} ({t.ext.toUpperCase()}, {humanSize(t.size)})
          {t.convertStatus === 'done' ? ' ✓' : ''}
          {['pending', 'processing', 'rasterizing', 'retrying'].includes(t.convertStatus) ? ' ⏳' : ''}
        </option>
      ))}
    </select>
  )
}

/* ============ 模式 1：格式转换 ============ */
function ConvertMode({ tasks }: { tasks: Task[] }) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [target, setTarget] = useState<TargetFmt>('pdf')
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTask = useMemo(() => tasks.find(t => t.id === taskId) || null, [tasks, taskId])

  const runConvert = useCallback(async () => {
    if (!taskId) return
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, target }),
      })
      const d: ConvertResult = await r.json()
      if (!r.ok) throw new Error((d as any).error || `转换失败 ${r.status}`)
      setResult(d)
      // 进行中：5s 后轮询
      if (['pending', 'processing', 'rasterizing', 'retrying'].includes(d.status)) {
        setTimeout(runConvert, 2000)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [taskId, target])

  // 复制全部文字
  const copyAllText = useCallback(async () => {
    const pages = result?.pages || []
    if (!pages.length) return
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
  }, [result])

  if (!tasks.length) {
    return (
      <div className="xf-empty" style={{ padding: 60 }}>
        <div className="xf-empty-icon">📭</div>
        <div className="xf-empty-title">暂无可转换的文档</div>
        <div className="xf-empty-desc">请先在"文档预览"页上传 Office/PDF/图片文件</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }} data-testid="fc-convert-mode">
      {/* 控制条 */}
      <div className="oa-card" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <LayersIcon size={18} style={{ color: 'var(--color-primary)' }} />
        <SourcePicker tasks={tasks} value={taskId} onChange={setTaskId} testId="fc-source-select" />
        {/* 目标格式 toggle */}
        <div className="oa-tabs" style={{ borderBottom: 'none' }}>
          {(['pdf', 'images'] as const).map(t => (
            <button
              key={t}
              className={`oa-tab ${target === t ? 'active' : ''}`}
              onClick={() => setTarget(t)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {t === 'pdf' ? <><FileTextIcon size={14} /> PDF</> : <>🖼️ 高清图片</>}
            </button>
          ))}
        </div>
        <button
          className="oa-btn oa-btn-primary"
          onClick={runConvert}
          disabled={!taskId || loading}
          data-testid="fc-convert-btn"
        >
          {loading ? <><span className="xf-loading" /> 转换中…</> : '🔄 开始转换'}
        </button>
        {selectedTask?.convertStatus === 'done' && (
          <span style={{ fontSize: 13, color: 'var(--color-success)' }}>✓ 已转换 · 可直接预览</span>
        )}
      </div>

      {error && (
        <div className="oa-alert oa-alert-warning" style={{ marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {/* 进行中 */}
      {result && ['pending', 'processing', 'rasterizing', 'retrying'].includes(result.status) && (
        <div className="oa-card" style={{ padding: 24, textAlign: 'center' }}>
          <span className="xf-loading" style={{ width: 32, height: 32, margin: '0 auto 12px', display: 'block', borderWidth: 3 }} />
          <div style={{ fontWeight: 600, marginBottom: 8 }}>转换进行中…</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
            {result.progress?.pagesDone || 0} / {result.progress?.pagesTotal || 0} 页 · {result.progress?.pct || 0}%
          </div>
          <div style={{ width: 320, height: 4, background: 'var(--color-border-light)', borderRadius: 2, margin: '12px auto 0', overflow: 'hidden' }}>
            <div style={{
              width: `${result.progress?.pct || 0}%`, height: '100%',
              background: 'var(--color-primary)', transition: 'width 300ms ease',
            }} />
          </div>
        </div>
      )}

      {/* 失败 */}
      {result?.status === 'failed' && (
        <div className="oa-card" style={{ padding: 24, color: 'var(--color-danger)' }}>
          ❌ 转换失败：{result.error}
        </div>
      )}

      {/* 完成产物 */}
      {result?.status === 'done' && (
        <ConvertOutputs result={result} taskName={selectedTask?.name || 'document'} onCopyAll={copyAllText} />
      )}
    </div>
  )
}

function ConvertOutputs({ result, taskName, onCopyAll }: {
  result: ConvertResult
  taskName: string
  onCopyAll: () => void
}) {
  const pages = result.pages || []
  const meta = result.meta
  const baseName = taskName.replace(/\.[^.]+$/, '')

  return (
    <>
      {/* 统计 */}
      <div className="oa-stat-grid" style={{ marginBottom: 16 }}>
        <div className="oa-stat-card">
          <div className="oa-stat-label">PDF 大小</div>
          <div className="oa-stat-value">{humanSize(meta?.pdfSize)}</div>
          <div className="oa-stat-delta">{meta?.ext.toUpperCase()} → PDF</div>
        </div>
        <div className="oa-stat-card">
          <div className="oa-stat-label">图片页数</div>
          <div className="oa-stat-value" style={{ color: 'var(--color-primary)' }}>{meta?.pagesCount || 0}</div>
          <div className="oa-stat-delta">栅格化高清</div>
        </div>
        <div className="oa-stat-card">
          <div className="oa-stat-label">转换耗时</div>
          <div className="oa-stat-value" style={{ color: 'var(--color-success)' }}>
            {meta?.convertMs ? `${(meta.convertMs / 1000).toFixed(1)}s` : '-'}
          </div>
          <div className="oa-stat-delta">{meta?.engine}</div>
        </div>
        <div className="oa-stat-card">
          <div className="oa-stat-label">策略</div>
          <div className="oa-stat-value" style={{ fontSize: 16 }}>{meta?.strategy}</div>
          <div className="oa-stat-delta">自动决策</div>
        </div>
      </div>

      {/* 产物卡 */}
      <div className="oa-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>📦 转换产物</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {/* PDF */}
          <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>📕</span>
              <div>
                <div style={{ fontWeight: 600 }}>PDF 文档</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{humanSize(meta?.pdfSize)}</div>
              </div>
            </div>
            {result.pdfUrl && (
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="oa-btn oa-btn-primary oa-btn-sm" href={result.pdfUrl} target="_blank" rel="noreferrer">
                  在线预览
                </a>
                <a className="oa-btn oa-btn-default oa-btn-sm" href={result.pdfUrl} download={`${baseName}.pdf`}>
                  <DownloadIcon size={12} /> 下载
                </a>
              </div>
            )}
          </div>

          {/* 原文件 */}
          {result.originalUrl && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>📄</span>
                <div>
                  <div style={{ fontWeight: 600 }}>原始文件</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{meta?.ext.toUpperCase()}</div>
                </div>
              </div>
              <a className="oa-btn oa-btn-default oa-btn-sm" href={result.originalUrl} download={taskName}>
                <DownloadIcon size={12} /> 下载原文件
              </a>
            </div>
          )}

          {/* 复制文字 */}
          {pages.some(p => p.textUrl) && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>📝</span>
                <div>
                  <div style={{ fontWeight: 600 }}>文字层</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{pages.length} 页可复制</div>
                </div>
              </div>
              <button className="oa-btn oa-btn-default oa-btn-sm" onClick={onCopyAll}>
                <CopyIcon size={12} /> 复制全部文字
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 页面缩略图 */}
      {pages.length > 0 && (
        <div className="oa-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>🖼️ 图片产物（{pages.length} 页）</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {pages.map(p => (
              <a
                key={p.page}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  border: '1px solid var(--color-border-light)', borderRadius: 6, overflow: 'hidden',
                  background: 'var(--color-bg-subtle)', textDecoration: 'none', color: 'inherit',
                  transition: 'transform 200ms, box-shadow 200ms',
                }}
                className="fc-thumb-card"
                title={`第 ${p.page} 页 · ${p.width}×${p.height}`}
              >
                <img
                  src={p.url}
                  alt={`第 ${p.page} 页`}
                  loading="lazy"
                  style={{ width: '100%', height: 180, objectFit: 'contain', display: 'block' }}
                />
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', fontSize: 11, color: 'var(--color-text-tertiary)',
                  borderTop: '1px solid var(--color-border-light)', background: '#fff',
                }}>
                  <span>第 {p.page} 页</span>
                  {p.textUrl && <span style={{ color: 'var(--color-success)' }}>文字 ✓</span>}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ============ 模式 2：对比预览（双栏） ============ */
function CompareMode({ tasks }: { tasks: Task[] }) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const task = useMemo(() => tasks.find(t => t.id === taskId) || null, [tasks, taskId])

  if (!tasks.length) {
    return <div className="xf-empty" style={{ padding: 60 }}>
      <div className="xf-empty-icon">📭</div>
      <div className="xf-empty-title">暂无文档</div>
    </div>
  }

  return (
    <div style={{ padding: 24 }} data-testid="fc-compare-mode">
      <div className="oa-card" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <SourcePicker tasks={tasks} value={taskId} onChange={setTaskId} testId="fc-compare-source" />
        {task && (
          <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
            原文件 ({task.ext.toUpperCase()}) ↔ 转换产物 (PDF + 图片)
          </span>
        )}
      </div>

      {!task && (
        <div className="xf-empty" style={{ padding: 60 }}>
          <div className="xf-empty-icon">👈</div>
          <div className="xf-empty-title">请选择文档</div>
          <div className="xf-empty-desc">对比原文件与转换后的产物</div>
        </div>
      )}

      {task && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} data-testid="fc-compare-grid">
          {/* 左：原文件 */}
          <div className="oa-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="oa-tab active" style={{ borderBottom: 'none' }}>📄 原文件</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{task.name}</span>
            </div>
            <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto', background: 'var(--color-bg-subtle)', textAlign: 'center' }}>
              <OriginalPreview task={task} />
            </div>
          </div>

          {/* 右：转换产物 */}
          <div className="oa-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="oa-tab active" style={{ borderBottom: 'none' }}>🖼️ 转换产物</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {task.pages?.length || 0} 页 · {humanSize(task.previewSize)}
              </span>
            </div>
            <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto', background: 'var(--color-bg-subtle)' }}>
              <ConvertedPreview task={task} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OriginalPreview({ task }: { task: Task }) {
  const ext = task.ext.toLowerCase()
  // 图片直接显示
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) {
    return <img src={task.originalUrl} alt={task.name} style={{ maxWidth: '100%' }} />
  }
  // PDF iframe
  if (ext === 'pdf') {
    return <iframe src={task.originalUrl} title="original" style={{ width: '100%', height: '60vh', border: 'none', background: '#fff' }} />
  }
  // txt/md 直接显示
  if (['txt', 'md'].includes(ext)) {
    return <OriginalTextPreview url={task.originalUrl} />
  }
  // Office 文档无法浏览器原生渲染，提示
  return (
    <div className="xf-empty" style={{ padding: 48 }}>
      <div className="xf-empty-icon" style={{ fontSize: 40 }}>📋</div>
      <div className="xf-empty-title">{ext.toUpperCase()} 原文件</div>
      <div className="xf-empty-desc">Office 文档需转换后预览，请看右侧</div>
      <a className="oa-btn oa-btn-default oa-btn-sm" href={task.originalUrl} download={task.name} style={{ marginTop: 12 }}>
        <DownloadIcon size={12} /> 下载原文件
      </a>
    </div>
  )
}

function OriginalTextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    fetch(url).then(r => r.text()).then(setText).catch(() => setText(null))
  }, [url])
  if (text === null) return <span className="xf-loading" />
  return (
    <pre style={{ textAlign: 'left', background: '#fff', padding: 16, borderRadius: 6, fontSize: 13, lineHeight: 1.7, maxHeight: '60vh', overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text}
    </pre>
  )
}

function ConvertedPreview({ task }: { task: Task }) {
  const pages = task.pages || []
  if (!pages.length) {
    return (
      <div className="xf-empty" style={{ padding: 48 }}>
        <div className="xf-empty-icon">⏳</div>
        <div className="xf-empty-title">尚未生成图片产物</div>
        <div className="xf-empty-desc">请切换到"格式转换"标签触发转换</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      {pages.map(p => (
        <div key={p.page} style={{ background: '#fff', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', maxWidth: '100%' }}>
          <img src={p.url} alt={`第 ${p.page} 页`} loading="lazy" style={{ display: 'block', width: '100%' }} />
          <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--color-text-tertiary)', background: 'var(--color-bg-subtle)', borderTop: '1px solid var(--color-border-light)' }}>
            第 {p.page} 页 · {p.width}×{p.height}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ============ 模式 3：文字标注 ============ */
function AnnotateMode({ tasks }: { tasks: Task[] }) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [pageIdx, setPageIdx] = useState(0) // 0-based
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loadingAnn, setLoadingAnn] = useState(false)
  const [selection, setSelection] = useState<string>('')
  const [note, setNote] = useState('')
  const [color, setColor] = useState('var(--color-warning-bg)')
  const [copied, setCopied] = useState(false)

  const task = useMemo(() => tasks.find(t => t.id === taskId) || null, [tasks, taskId])
  const pages = task?.pages || []
  const currentPage = pages[pageIdx]

  // 加载标注
  const refreshAnnotations = useCallback(async () => {
    if (!taskId) { setAnnotations([]); return }
    setLoadingAnn(true)
    try {
      const r = await fetch(`/api/annotate/${taskId}`)
      if (r.ok) {
        const d = await r.json()
        setAnnotations(d.annotations || [])
      }
    } finally {
      setLoadingAnn(false)
    }
  }, [taskId])

  useEffect(() => {
    refreshAnnotations()
  }, [refreshAnnotations])

  useEffect(() => {
    if (pageIdx > pages.length - 1) setPageIdx(0)
  }, [pages.length, pageIdx])

  const pageAnnotations = useMemo(
    () => annotations.filter(a => a.page === pageIdx + 1),
    [annotations, pageIdx],
  )

  // 文字层选区
  const textLayerRef = useRef<HTMLDivElement>(null)
  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || !textLayerRef.current) return
    const range = sel.getRangeAt(0)
    if (!textLayerRef.current.contains(range.commonAncestorContainer)) {
      setSelection('')
      return
    }
    const txt = sel.toString().trim()
    setSelection(txt)
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [handleSelectionChange])

  const createAnnotation = useCallback(async () => {
    if (!taskId || !selection) return
    try {
      const r = await fetch('/api/annotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, page: pageIdx + 1, text: selection, note, color }),
      })
      if (r.ok) {
        setSelection('')
        setNote('')
        await refreshAnnotations()
      }
    } catch (e) {
      console.error('[annotate] create failed', e)
    }
  }, [taskId, selection, note, color, pageIdx, refreshAnnotations])

  const deleteAnnotation = useCallback(async (id: string) => {
    if (!taskId) return
    try {
      const r = await fetch(`/api/annotate/${id}?taskId=${taskId}`, { method: 'DELETE' })
      if (r.ok) await refreshAnnotations()
    } catch (e) {
      console.error('[annotate] delete failed', e)
    }
  }, [taskId, refreshAnnotations])

  const copySelected = useCallback(async () => {
    if (!selection) return
    await navigator.clipboard.writeText(selection)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [selection])

  const copyPageText = useCallback(async () => {
    if (!currentPage?.textUrl) return
    try {
      const r = await fetch(currentPage.textUrl)
      const html = await r.text()
      const div = document.createElement('div')
      div.innerHTML = html
      const text = (div.textContent || '').trim()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }, [currentPage])

  // 文字层 HTML（hooks 必须在所有条件 return 之前）
  const [textHtml, setTextHtml] = useState<string | null>(null)
  useEffect(() => {
    if (!currentPage?.textUrl) { setTextHtml(null); return }
    let alive = true
    fetch(currentPage.textUrl).then(r => r.text()).then(html => {
      if (!alive) return
      // 提取 spans（去外层 div）
      const open = html.indexOf('>')
      const close = html.lastIndexOf('</div>')
      const inner = (open >= 0 && close > open) ? html.slice(open + 1, close) : html
      setTextHtml(inner)
    }).catch(() => alive && setTextHtml(null))
    return () => { alive = false }
  }, [currentPage?.textUrl])

  if (!tasks.length) {
    return <div className="xf-empty" style={{ padding: 60 }}>
      <div className="xf-empty-icon">📭</div>
      <div className="xf-empty-title">暂无可标注文档</div>
      <div className="xf-empty-desc">请先上传 Office/PDF 文件</div>
    </div>
  }

  return (
    <div style={{ padding: 24 }} data-testid="fc-annotate-mode">
      {/* 顶部控制条 */}
      <div className="oa-card" style={{ padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SourcePicker tasks={tasks} value={taskId} onChange={(id) => { setTaskId(id); setPageIdx(0) }} testId="fc-anno-source" />

        {pages.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="oa-btn oa-btn-default oa-btn-sm" onClick={() => setPageIdx(i => Math.max(0, i - 1))} disabled={pageIdx === 0}>←</button>
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', minWidth: 70, textAlign: 'center' }}>
                {pageIdx + 1} / {pages.length}
              </span>
              <button className="oa-btn oa-btn-default oa-btn-sm" onClick={() => setPageIdx(i => Math.min(pages.length - 1, i + 1))} disabled={pageIdx >= pages.length - 1}>→</button>
            </div>
            <button className="oa-btn oa-btn-default oa-btn-sm" onClick={copyPageText} disabled={!currentPage?.textUrl}>
              <CopyIcon size={12} /> 复制本页文字
            </button>
          </>
        )}
      </div>

      {!task && (
        <div className="xf-empty" style={{ padding: 60 }}>
          <div className="xf-empty-icon">👈</div>
          <div className="xf-empty-title">请选择文档</div>
          <div className="xf-empty-desc">在文字层上划选即可标注、复制</div>
        </div>
      )}

      {task && !pages.length && (
        <div className="xf-empty" style={{ padding: 60 }}>
          <div className="xf-empty-icon">⏳</div>
          <div className="xf-empty-title">无图片产物</div>
          <div className="xf-empty-desc">请先到"格式转换"标签触发转换</div>
        </div>
      )}

      {currentPage && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          {/* 左：图片+文字层（可选中） */}
          <div className="oa-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>📖 第 {pageIdx + 1} 页</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>· 在文字上划选 → 标注 / 复制</span>
              {copied && <span style={{ fontSize: 12, color: 'var(--color-success)', marginLeft: 'auto' }}>✓ 已复制</span>}
            </div>
            <div style={{ padding: 24, background: 'var(--color-bg-subtle)', maxHeight: '70vh', overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
              <div style={{ position: 'relative', width: currentPage.width, height: currentPage.height, background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.1)' }}>
                <img src={currentPage.url} alt={`page ${pageIdx + 1}`} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
                {textHtml && (
                  <div
                    ref={textLayerRef}
                    className="pdf-text-layer"
                    data-page={pageIdx}
                    dangerouslySetInnerHTML={{ __html: textHtml }}
                    style={{ position: 'absolute', left: 0, top: 0 }}
                  />
                )}
                {/* 已有标注高亮覆盖 */}
                {pageAnnotations.map(a => (
                  <div
                    key={a.id}
                    style={{
                      position: 'absolute',
                      left: 4, top: 4 + pageAnnotations.indexOf(a) * 32,
                      background: a.color || 'var(--color-warning-bg)',
                      color: '#333',
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: '1px solid rgba(0,0,0,0.1)',
                      maxWidth: '70%',
                      pointerEvents: 'auto',
                      cursor: 'help',
                    }}
                    title={`${a.text}${a.note ? ' — ' + a.note : ''}`}
                  >
                    💬 {(a.note || a.text).slice(0, 30)}{(a.note || a.text).length > 30 ? '…' : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右：标注操作面板 */}
          <div className="oa-card" style={{ padding: 16, alignSelf: 'start', maxHeight: '70vh', overflow: 'auto' }}>
            {/* 新建标注 */}
            {selection ? (
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--color-warning-bg)', border: '1px solid var(--amber-2)', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>已选文字：</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8, maxHeight: 80, overflow: 'auto' }}>
                  "{selection.slice(0, 120)}{selection.length > 120 ? '…' : ''}"
                </div>
                <textarea
                  placeholder="批注（可选）…"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  style={{ width: '100%', minHeight: 60, padding: 8, fontSize: 13, border: '1px solid var(--color-border-light)', borderRadius: 4, resize: 'vertical', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>颜色：</span>
                  {['var(--color-warning-bg)', 'var(--magenta-2)', 'var(--color-success-bg)', 'var(--blue-2)', 'var(--purple-2)'].map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        width: 20, height: 20, borderRadius: '50%', background: c,
                        border: color === c ? '2px solid var(--color-primary)' : '1px solid var(--color-border-light)',
                        cursor: 'pointer', padding: 0,
                      }}
                      aria-label={`color ${c}`}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="oa-btn oa-btn-primary oa-btn-sm" onClick={createAnnotation}>📌 标注</button>
                  <button className="oa-btn oa-btn-default oa-btn-sm" onClick={copySelected}>
                    <CopyIcon size={12} /> 复制
                  </button>
                  <button className="oa-btn oa-btn-ghost oa-btn-sm" onClick={() => { setSelection(''); setNote('') }}>取消</button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 16, padding: 16, background: 'var(--color-bg-subtle)', borderRadius: 6, textAlign: 'center', fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                💡 在左侧文字层上 <strong>划选</strong> 即可创建标注 / 复制
              </div>
            )}

            {/* 标注列表 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>📋 本页标注</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>({pageAnnotations.length})</span>
              {loadingAnn && <span className="xf-loading" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
            </div>
            {pageAnnotations.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-placeholder)', textAlign: 'center', padding: 16 }}>暂无标注</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pageAnnotations.map(a => (
                  <div key={a.id} style={{ padding: 10, borderRadius: 6, background: a.color || 'var(--color-warning-bg)', fontSize: 12, border: '1px solid rgba(0,0,0,0.08)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: '#333', lineHeight: 1.5 }}>
                      "{a.text.slice(0, 50)}{a.text.length > 50 ? '…' : ''}"
                    </div>
                    {a.note && <div style={{ color: '#555', marginBottom: 6, lineHeight: 1.5 }}>{a.note}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10, color: '#888' }}>{new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                      <button
                        onClick={() => deleteAnnotation(a.id)}
                        style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 4, display: 'inline-flex', alignItems: 'center' }}
                        title="删除"
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
