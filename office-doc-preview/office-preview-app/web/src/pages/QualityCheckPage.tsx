// QualityCheckPage — 讯飞智检风格（对标讯飞设计稿）
// 模型：claude-sonnet-4-6
// 布局：嵌入 AppLayoutV2 oa-main，不再自建全屏 topbar。
// 子菜单 + 内容区使用 xf-workspace（flex row），撑满父容器。
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ShieldCheckIcon, CopyIcon, CheckIcon } from '../design/icons'

interface QCErrorItem {
  id: string
  original: string
  corrected: string
  type: string
  reason?: string
  position: number
}

/** 从原文 + 错误列表构造改正后文本（按 position 排序后拼接） */
function buildCorrectedText(leftText: string, errors: QCErrorItem[]): string {
  if (!errors.length) return leftText
  const sorted = [...errors].sort((a, b) => a.position - b.position)
  let out = ''
  let cursor = 0
  for (const err of sorted) {
    if (err.position < cursor) continue  // 重叠：跳过
    out += leftText.slice(cursor, err.position)
    out += err.corrected
    cursor = err.position + Array.from(err.original).length
  }
  out += leftText.slice(cursor)
  return out
}

type SubmenuKey = 'text' | 'doc' | 'text-compliance' | 'doc-compliance' | 'image' | 'audio' | 'video'

const SUBMENU: { key: SubmenuKey; label: string }[] = [
  { key: 'text', label: '文字校对' },
  { key: 'doc', label: '文档校对' },
  { key: 'text-compliance', label: '文本合规' },
  { key: 'doc-compliance', label: '文档合规' },
  { key: 'image', label: '图片合规' },
  { key: 'audio', label: '音频合规' },
  { key: 'video', label: '视频合规' },
]

export function QualityCheckPage() {
  const [submenu, setSubmenu] = useState<SubmenuKey>('text')
  const [leftText, setLeftText] = useState('')
  const [errors, setErrors] = useState<QCErrorItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedErrId, setSelectedErrId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ ms: number; engine: string } | null>(null)

  const [toolbar, setToolbar] = useState({
    bold: false, header: false, italic: false, underline: false, strike: false,
  })

  const editorRef = useRef<HTMLDivElement>(null)

  // 加载示例
  useEffect(() => {
    fetch('/api/sample/智检样例_原文.txt').then(r => r.ok ? r.text() : '').then(t => {
      if (t) setLeftText(t)
    }).catch(() => {})
  }, [])

  const doCheck = useCallback(async () => {
    if (!leftText.trim()) return
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/inspect/quality-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ text: leftText }),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      const data = await r.json()
      const list: QCErrorItem[] = (data.errors || []).map((e: any, i: number) => ({
        id: e.id || `qc-${i}`,
        original: e.original || '',
        corrected: e.corrected || '',
        type: e.type || 'other',
        reason: e.reason,
        position: e.position ?? i,
      }))
      setErrors(list)
      setStats({ ms: data.ms || 0, engine: data.engine || 'ai-qc' })
      setSelectedErrId(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [leftText])

  // ============ hover 联动：token ↔ error 卡 ============
  // tracked: which err is hovered + which side initiated hover (card 只 hover token 才滚动，避免互滚)
  const [hoveredErrId, setHoveredErrId] = useState<string | null>(null)
  const hoverSourceRef = useRef<'card' | 'token' | null>(null)
  const lastScrollTsRef = useRef(0)
  const setHover = useCallback((id: string | null, source: 'card' | 'token' | null = null) => {
    setHoveredErrId(id)
    if (id && source) {
      hoverSourceRef.current = source
      // debounce: 80ms 内不重复滚
      const now = Date.now()
      if (now - lastScrollTsRef.current < 80) return
      lastScrollTsRef.current = now
      // 等下一帧让 hovered class 生效再滚
      requestAnimationFrame(() => {
        const sel = source === 'card' ? `[data-err-id="${id}"]` : `[data-testid="qc-error-card-${id}"]`
        const el = document.querySelector(sel) as HTMLElement | null
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
        }
      })
    }
  }, [])

  const sortedErrors = useMemo(
    () => [...errors].sort((a, b) => a.position - b.position),
    [errors]
  )

  // 改正后文本（按 position 替换 original → corrected）
  const correctedText = useMemo(
    () => buildCorrectedText(leftText, sortedErrors),
    [leftText, sortedErrors]
  )

  const renderEditor = useCallback(() => {
    if (sortedErrors.length === 0) {
      return <span style={{ whiteSpace: 'pre-wrap' }}>{leftText || '请输入待校对文本…'}</span>
    }
    const pieces: Array<{ text: string; isErr: boolean; errId?: string; isSelected?: boolean }> = []
    let cursor = 0
    for (const err of sortedErrors) {
      if (err.position > cursor) {
        pieces.push({ text: leftText.slice(cursor, err.position), isErr: false })
      }
      const sliceText = leftText.slice(err.position, err.position + err.original.length) || err.original
      pieces.push({
        text: sliceText,
        isErr: true,
        errId: err.id,
        isSelected: selectedErrId === err.id,
      })
      cursor = err.position + Array.from(err.original).length
    }
    if (cursor < leftText.length) {
      pieces.push({ text: leftText.slice(cursor), isErr: false })
    }
    return pieces.map((p, i) => {
      const hovered = p.errId && hoveredErrId === p.errId
      return p.isErr ? (
        <span
          key={i}
          data-err-id={p.errId}
          className={`xf-token error${p.isSelected ? ' selected' : ''}${hovered ? ' hovered' : ''}`}
          onClick={() => setSelectedErrId(p.errId || null)}
          onMouseEnter={() => setHover(p.errId || null, 'token')}
          onMouseLeave={() => setHover(null)}
          title={`${p.text} → ${errors.find(e => e.id === p.errId)?.corrected || ''}`}
        >{p.text}</span>
      ) : (
        <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p.text}</span>
      )
    })
  }, [leftText, sortedErrors, errors, selectedErrId, hoveredErrId, setHover])

  const errorNo = useCallback((idx: number) => String(idx + 1).padStart(2, '0'), [])

  return (
    <div className="xf-workspace">
      <div className="xf-submenu">
        {SUBMENU.map(s => (
          <button
            key={s.key}
            className={`xf-submenu-item${submenu === s.key ? ' active' : ''}`}
            onClick={() => setSubmenu(s.key)}
          >{s.label}</button>
        ))}
      </div>

      <div className="xf-content">
        {/* 工具按钮条 */}
        <div style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--xf-border-light)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'var(--xf-bg-subtle)',
        }}>
          <button
            className="xf-btn-solid"
            onClick={doCheck}
            disabled={loading || !leftText.trim()}
            style={{ minWidth: 100 }}
          >
            {loading ? <><span className="xf-loading" /> 校对中…</> : <><ShieldCheckIcon size={14} /> 开始校对</>}
          </button>
          {stats && (
            <span style={{ fontSize: 13, color: 'var(--xf-text-secondary)' }}>
              共发现 <strong style={{ color: 'var(--xf-danger)' }}>{errors.length}</strong> 处错误 · {stats.engine} · {stats.ms}ms
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="xf-mini-btn"
            onClick={() => navigator.clipboard.writeText(leftText)}
            disabled={!leftText}
          >
            <CopyIcon size={12} /> 复制
          </button>
          <button
            className="xf-mini-btn"
            onClick={() => { setLeftText(''); setErrors([]); setSelectedErrId(null) }}
            disabled={!leftText && errors.length === 0}
          >
            清空
          </button>
        </div>

        {error && (
          <div style={{
            padding: '8px 24px', background: 'var(--xf-danger-bg)',
            borderBottom: '1px solid var(--xf-danger-border)',
            color: 'var(--xf-danger)', fontSize: 13,
          }}>
            请求失败：{error}
          </div>
        )}

        {/* 主体: 编辑器 + 错误列表 */}
        <div className="xf-editor-layout">
          <div className="xf-editor-main">
            <div
              ref={editorRef}
              className="xf-editor-canvas xf-text"
              onClick={() => setSelectedErrId(null)}
            >
              {renderEditor()}
            </div>

            <div className="xf-editor-toolbar">
              {[
                { key: 'bold', label: 'B', style: { fontWeight: 700 } },
                { key: 'header', label: 'H', style: { fontFamily: 'serif', fontWeight: 600 } },
                { key: 'italic', label: <i>I</i>, style: { fontStyle: 'italic' } },
                { key: 'underline', label: <u>U</u>, style: {} },
                { key: 'strike', label: <s>S</s>, style: {} },
              ].map(t => (
                <button
                  key={t.key}
                  className={`xf-tb-btn${toolbar[t.key as keyof typeof toolbar] ? ' active' : ''}`}
                  onClick={() => setToolbar(prev => ({ ...prev, [t.key]: !prev[t.key as keyof typeof toolbar] }))}
                  style={t.style}
                >{t.label}</button>
              ))}
              <span className="xf-tb-divider" />
              <button className="xf-tb-btn" title="字号">12</button>
              <button className="xf-tb-btn" title="字体">宋体</button>
              <span className="xf-tb-divider" />
              <button className="xf-tb-btn" title="撤销">↶</button>
              <button className="xf-tb-btn" title="重做">↷</button>
              <span className="xf-tb-divider" />
              <button className="xf-tb-btn" title="清除格式">⌫</button>
              <div className="xf-tb-spacer" />
              <span style={{ fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
                {leftText.length} 字符 · {errors.length} 处错误
              </span>
            </div>
          </div>

          <div className="xf-error-list">
            {sortedErrors.length === 0 ? (
              <div className="xf-empty">
                {loading ? '正在校对…' : '暂无错误，点击"开始校对"检测文本'}
              </div>
            ) : sortedErrors.map((err, i) => (
              <div
                key={err.id}
                data-testid={`qc-error-card-${err.id}`}
                data-err-id={err.id}
                className={`xf-error-card${selectedErrId === err.id ? ' selected' : ''}${hoveredErrId === err.id ? ' hovered' : ''}`}
                onClick={() => setSelectedErrId(err.id)}
                onMouseEnter={() => setHover(err.id, 'card')}
                onMouseLeave={() => setHover(null)}
              >
                <div className="xf-error-card-header">
                  <span className="xf-error-card-no">{errorNo(i)}</span>
                </div>
                <div className="xf-error-card-diff">
                  <span className="xf-error-original">{err.original || '(空)'}</span>
                  <span className="xf-error-arrow">→</span>
                  <span className="xf-error-corrected">{err.corrected}</span>
                </div>
                <div className="xf-error-card-meta">
                  错误类型：{err.type}
                </div>
                {selectedErrId === err.id && (
                  <div className="xf-error-card-actions">
                    <button className="xf-mini-btn primary" onClick={e => { e.stopPropagation() }}>比对</button>
                    <button className="xf-mini-btn" onClick={e => { e.stopPropagation() }}>改写</button>
                    <button className="xf-mini-btn danger" onClick={e => { e.stopPropagation(); setErrors(prev => prev.filter(x => x.id !== err.id)) }}>忽略</button>
                  </div>
                )}
              </div>
            ))}
            {sortedErrors.length > 0 && (
              <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
                <CheckIcon size={12} /> 已显示全部 {sortedErrors.length} 处错误
              </div>
            )}
          </div>
        </div>

        {/* 改正后双栏：左侧编辑器的"改正后"对照 */}
        {sortedErrors.length > 0 && (
          <div
            data-testid="qc-corrected-pane"
            className="xf-corrected-pane"
            style={{
              borderTop: '1px solid var(--xf-border-light)',
              background: 'var(--xf-bg-subtle)',
              padding: '12px 24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>改正后文本</span>
              <span style={{ fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
                （按校对建议自动拼接，可一键复制）
              </span>
              <div style={{ flex: 1 }} />
              <button
                className="xf-mini-btn"
                onClick={() => navigator.clipboard.writeText(correctedText)}
              >
                <CopyIcon size={12} /> 复制改正后
              </button>
            </div>
            <div
              data-testid="qc-corrected-text"
              style={{
                padding: 12,
                background: '#fff',
                border: '1px solid var(--xf-border-light)',
                borderRadius: 4,
                fontSize: 14,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                minHeight: 60,
              }}
            >{correctedText}</div>
          </div>
        )}
      </div>
    </div>
  )
}