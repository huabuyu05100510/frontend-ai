// 双栏对比 / 智检 / 翻译双栏对照 — 顶层弹层（薄协调器）
// 重构：对标设计稿 讯飞智检.png + 翻译对比.png
// 模型：claude-sonnet-4-6
// Phase 2.A: 迁移至 Modal primitive（bare 模式）保留 .inspect-compare-modal / .icm-* 原 CSS
//
// 职责：弹层壳 + 工具栏 + mode 切换 + diff 数据加载 + 委托子组件渲染
// 子组件：InspectView（智检） / DualLayout（双栏对比） / TranslationLayout（翻译双栏对照）
import { useEffect, useRef, useState, useCallback } from 'react'
import type { Task, InspectMode, InspectDiffResponse } from '../types'
import { InspectView } from './InspectView'
import { DualLayout } from './DualLayout'
import { TranslationLayout } from './TranslationLayout'
import { extractText } from './text-extract'
import { EDIT_TOOLS } from './constants'
import { useStore } from '../store'
import { Modal, type ModalCloseReason } from '../components/Modal'

interface Props {
  open: boolean
  source: Task | null
  compare: Task | null
  onClose: () => void
  defaultMode?: InspectMode
}

export function InspectCompareModal({ open, source, compare, onClose, defaultMode = 'inspect' }: Props) {
  // 单一真源：store 的 inspectMode（修复 Bug 1: mode 状态重复）
  const mode = useStore(s => s.inspectMode)
  const setMode = useStore(s => s.setInspectMode)
  // 翻译双栏（独立打开标志，避免与 inspectOpen 冲突）
  const openTranslate = useStore(s => s.openTranslate)
  const closeTranslate = useStore(s => s.closeTranslate)
  const [loading, setLoading] = useState(false)

  // 修复 Bug 2: defaultMode 过期 — 在 open false→true 时同步
  const prevOpenRef = useRef(open)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      console.info('[inspect-modal] opened src=', source?.id, 'cmp=', compare?.id || 'none', 'mode=', mode)
      if (defaultMode !== mode) setMode(defaultMode)
    }
    if (!open && prevOpenRef.current) {
      console.info('[inspect-modal] closed')
    }
    prevOpenRef.current = open
  }, [open, source?.id, compare?.id, defaultMode, mode, setMode])

  // mode 切换日志
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (mode !== prevModeRef.current && open) {
      console.info('[inspect-modal] mode-change from=', prevModeRef.current, 'to=', mode)
    }
    prevModeRef.current = mode
  }, [mode, open])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [diff, setDiff] = useState<InspectDiffResponse | null>(null)

  // 关闭时同步清理翻译状态
  useEffect(() => {
    if (!open) closeTranslate()
  }, [open, closeTranslate])

  const loadDiff = useCallback(async () => {
    if (!open || !source) return
    setLoading(true)
    setLoadError(null)
    try {
      const leftText = await extractText(source)
      const rightText = compare ? await extractText(compare) : leftText
      const t0 = performance.now()
      const r = await fetch('/api/inspect/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ left: leftText, right: rightText, granularity: 'paragraph' }),
      })
      if (!r.ok) throw new Error(`diff API ${r.status}`)
      const data: InspectDiffResponse = await r.json()
      const t1 = performance.now()
      console.info('[inspect-modal] diff-loaded mode=', useStore.getState().inspectMode, 'src=', source.id, 'errors=', data.errors.length, 'paragraphs=', data.paragraphBlocks?.length ?? '-', 'ms=', (t1 - t0).toFixed(1))
      setDiff(data)
    } catch (e: any) {
      console.error('[inspect] load failed:', e)
      setLoadError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [open, source, compare])

  useEffect(() => { loadDiff() }, [loadDiff])

  // 模式切换：翻译 → 打开翻译流 + 复用 source
  const handleModeChange = useCallback((next: InspectMode) => {
    setMode(next)
    if (next === 'translate' && source) {
      openTranslate(source)
    }
  }, [setMode, openTranslate, source])

  const handleClose = useCallback((_reason: ModalCloseReason) => {
    onClose()
  }, [onClose])

  if (!open || !source) return null

  const totalErrors = diff?.errors.length ?? 0

  return (
    <Modal
      open={open}
      onClose={handleClose}
      width="xl"
      maskClosable={true}
      bare
      className="inspect-modal-host"
    >
      <div className="inspect-compare-modal" data-testid="inspect-modal">
        <div className="icm-mask" onClick={() => onClose()} />
        <div className="icm-body">

          {/* ── 顶部工具条 ── */}
          <header className="icm-toolbar" data-testid="inspect-toolbar">
            <span className="icm-brand">讯飞智检</span>

            <div className="icm-mode-tabs" role="group" aria-label="对比模式">
              <button
                type="button"
                className={`icm-tab ${mode === 'inspect' ? 'is-active' : ''}`}
                aria-pressed={mode === 'inspect'}
                onClick={() => handleModeChange('inspect')}
              >智检</button>
              <button
                type="button"
                className={`icm-tab ${mode === 'dual' ? 'is-active' : ''}`}
                aria-pressed={mode === 'dual'}
                onClick={() => handleModeChange('dual')}
              >双栏对比</button>
              <button
                type="button"
                className={`icm-tab ${mode === 'translate' ? 'is-active' : ''}`}
                aria-pressed={mode === 'translate'}
                onClick={() => handleModeChange('translate')}
                data-testid="tab-translate"
              >翻译对照</button>
            </div>

            <div className="icm-toolbar-right">
              <button type="button" className="icm-btn-ghost">导出</button>
              <button type="button" className="icm-btn-ghost">分享</button>
              <button
                type="button"
                className="icm-btn-close"
                onClick={onClose}
                aria-label="关闭"
                title="关闭"
              >✕</button>
            </div>
          </header>

          {/* ── 智检模式（委托 InspectView）── */}
          {mode === 'inspect' && (
            <InspectView diff={diff} loading={loading} loadError={loadError} onRetry={loadDiff} />
          )}

          {/* ── 双栏对比模式（委托 DualLayout）── */}
          {mode === 'dual' && (
            <DualLayout
              source={source}
              compare={compare}
              diff={diff}
              loading={loading}
              loadError={loadError}
              onRetry={loadDiff}
            />
          )}

          {/* ── 翻译双栏对照模式（委托 TranslationLayout）── */}
          {mode === 'translate' && (
            <TranslationLayout />
          )}

          {/* ── 底部工具条 ── */}
          <footer className="icm-edit-bar">
            {mode === 'inspect' ? (
              <div className="icm-edit-tools">
                {EDIT_TOOLS.map((t, i) => (
                  <button key={i} type="button" className="icm-edit-btn">{t}</button>
                ))}
              </div>
            ) : mode === 'translate' ? null : (
              <span className="icm-footer-info">
                {diff && `Myers diff · ${diff.ms}ms · ${totalErrors} 处差异`}
              </span>
            )}
          </footer>

        </div>
      </div>
    </Modal>
  )
}