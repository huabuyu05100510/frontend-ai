// 智检模式视图 — 左侧分类导航 + 主文档区（错误下划线） + 右侧错误列表
// 从 InspectCompareModal 提取（重构后独立组件）
// 模型：claude-sonnet-4-6
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { InspectDiffResponse, RenderToken } from '../types'
import { ErrorToken } from './ErrorToken'
import { CATEGORIES } from './constants'

type ActionState = 'pending' | 'accepted' | 'ignored'

interface Props {
  diff: InspectDiffResponse | null
  loading: boolean
  loadError: string | null
  onRetry: () => void
}

export function InspectView({ diff, loading, loadError, onRetry }: Props) {
  const [errorStates, setErrorStates] = useState<Record<string, ActionState>>({})
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState('text')
  const mainRef = useRef<HTMLDivElement>(null)

  // 智检模式：左侧 token 流（equal+delete）
  const leftTokens = useMemo(() => (diff?.tokens || []).filter(t => t.type !== 'insert'), [diff])

  // 顺序映射 delete token → error id
  const enrichedLeft = useMemo(() => {
    if (!diff) return []
    const deletableErrors = diff.errors.filter(e => e.op !== 'insert')
    let ei = 0
    return leftTokens.map(token => {
      if (token.type === 'delete') {
        const errorId = deletableErrors[ei]?.id ?? null
        ei++
        return { ...token, errorId }
      }
      return { ...token, errorId: null }
    })
  }, [diff, leftTokens])

  const setErrorState = useCallback((id: string, state: ActionState) => {
    console.info('[inspect-view] error-', state, ' id=', id)
    setErrorStates(prev => ({ ...prev, [id]: state }))
  }, [])

  const toggleError = useCallback((id: string) => {
    const willSelect = selectedErrorId !== id
    console.info('[inspect-view] error-select id=', id, 'select=', willSelect)
    setSelectedErrorId(prev => prev === id ? null : id)
  }, [selectedErrorId])

  // 选中错误 → 滚动到主文档对应位置
  useEffect(() => {
    if (!selectedErrorId || !mainRef.current) return
    const el = mainRef.current.querySelector(`[data-error-id="${selectedErrorId}"]`)
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedErrorId])

  const totalErrors = diff?.errors.length ?? 0

  const retryBtn = (
    <button type="button" className="btn-mini" onClick={onRetry}>重试</button>
  )

  return (
    <div className="icm-inspect-layout">

      {/* 左：分类导航 */}
      <nav className="icm-cat-nav" aria-label="校对分类">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            type="button"
            className={`icm-cat-item ${activeCategory === cat.id ? 'is-active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      {/* 中：文档主体 */}
      <div className="icm-inspect-main" data-testid="inspect-left" ref={mainRef}>
        {loading && <div className="icm-msg">解析中…</div>}
        {loadError && (
          <div className="icm-msg icm-msg-err">
            加载失败：{loadError}
            {retryBtn}
          </div>
        )}
        {!loading && !loadError && diff && (
          <div className="icm-doc-text">
            {enrichedLeft.map((t, i) => (
              <ErrorToken
                key={i}
                token={t}
                isSelected={!!t.errorId && t.errorId === selectedErrorId}
                onClick={t.errorId ? () => toggleError(t.errorId!) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* 右：错误列表 */}
      <aside className="icm-error-panel" data-testid="inspect-diff-sidebar">
        <div className="icm-error-panel-hd">
          校对结果
          {diff && <span className="icm-error-badge">{totalErrors}</span>}
        </div>
        <ul className="icm-error-list">
          {diff?.errors.map((err, idx) => {
            const st = errorStates[err.id] || 'pending'
            const isSel = selectedErrorId === err.id
            return (
              <li
                key={err.id}
                data-error-id={err.id}
                className={`icm-error-item is-${st} ${isSel ? 'is-selected' : ''}`}
                onClick={() => toggleError(err.id)}
              >
                <div className="icm-error-row">
                  <span className="icm-error-idx">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="icm-error-orig">{err.original || '∅'}</span>
                  <span className="icm-error-sep">→</span>
                  <span className="icm-error-corr">{err.corrected || '∅'}</span>
                  <div className="icm-error-actions">
                    <button
                      type="button"
                      className={`icm-act-btn icm-act-accept ${st === 'accepted' ? 'is-done' : ''}`}
                      aria-label="接受"
                      title="接受"
                      onClick={e => { e.stopPropagation(); setErrorState(err.id, 'accepted') }}
                    >✓</button>
                    <button
                      type="button"
                      className={`icm-act-btn icm-act-ignore ${st === 'ignored' ? 'is-done' : ''}`}
                      aria-label="忽略"
                      title="忽略"
                      onClick={e => { e.stopPropagation(); setErrorState(err.id, 'ignored') }}
                    >−</button>
                  </div>
                </div>
                {isSel && (
                  <div className="icm-error-detail">
                    <span className="icm-error-type">错误类型：文字差错</span>
                    <div className="icm-detail-btns">
                      <button type="button" className="icm-detail-btn">比对</button>
                      <button type="button" className="icm-detail-btn">改写</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
          {diff && totalErrors === 0 && (
            <li className="icm-error-empty">✓ 暂无错误</li>
          )}
        </ul>
      </aside>
    </div>
  )
}
