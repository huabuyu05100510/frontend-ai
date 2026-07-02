// DictionaryCard — 浮动查词卡片（选中区域后弹出）
// 模型：claude-sonnet-4-6
import React, { useEffect, useRef } from 'react'
import { ConfidenceDot } from './ConfidenceDot'

interface Props {
  open: boolean
  anchor: { x: number; y: number } | null  // viewport-relative
  sourceText: string
  translation: string  // '' = "⏳ 翻译中…"
  confidence: number
  busy: boolean
  onClose: () => void
  onRetranslate: () => void
  onCopy: () => void
  onOpenGlossary: () => void
  onFontSizeChange: (delta: number) => void
  fontSize: number  // px
}

/**
 * 浮动查词卡片
 * - Esc 关闭 / Cmd+Enter 重新翻译
 * - 视口边缘 clamping（避免超出屏幕）
 * - z-index 1000
 * - 点击透明 backdrop 关闭
 */
export function DictionaryCard({
  open,
  anchor,
  sourceText,
  translation,
  confidence,
  busy,
  onClose,
  onRetranslate,
  onCopy,
  onOpenGlossary,
  onFontSizeChange,
  fontSize,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onRetranslate()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, onRetranslate])

  if (!open || !anchor) return null

  // 视口边缘 clamp（粗略估算；不引入 getBoundingClientRect 以兼容 jsdom）
  const CARD_W = 320
  const CARD_H = 200
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720
  const left = Math.max(8, Math.min(anchor.x, vw - CARD_W - 8))
  const top = Math.max(8, Math.min(anchor.y - CARD_H - 8, vh - CARD_H - 8))

  return (
    <>
      <div
        data-testid="dictionary-card-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          zIndex: 999,
        }}
      />
      <div
        ref={cardRef}
        data-testid="dictionary-card"
        role="dialog"
        aria-label="区域查词"
        style={{
          position: 'fixed',
          left,
          top,
          width: CARD_W,
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: 12,
          zIndex: 1000,
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8, gap: 8,
        }}>
          <span data-testid="dictionary-card-confidence">
            <ConfidenceDot confidence={confidence} showValue size={10} />
          </span>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>
            Esc 关闭 · ⌘+Enter 重译
          </span>
        </div>

        <div style={{
          fontSize: 12, color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
        }}>
          原文
        </div>
        <div
          data-testid="dictionary-card-source"
          style={{
            fontSize,
            color: 'var(--color-text)',
            padding: '4px 0 8px',
            borderBottom: '1px solid var(--color-border-light)',
            wordBreak: 'break-word',
          }}
        >
          {sourceText || '(空)'}
        </div>

        <div style={{
          fontSize: 12, color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 0.5,
          marginTop: 8, marginBottom: 4,
        }}>
          译文
        </div>
        <div
          data-testid="dictionary-card-translation"
          style={{
            fontSize,
            color: busy ? 'var(--color-text-tertiary)' : 'var(--color-primary)',
            minHeight: 24,
            wordBreak: 'break-word',
          }}
        >
          {busy ? '⏳ 翻译中…' : (translation || '(无译文)')}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: 12, paddingTop: 8,
          borderTop: '1px solid var(--color-border-light)',
        }}>
          <button
            data-testid="dictionary-card-font-down"
            onClick={() => onFontSizeChange(-1)}
            style={btnStyle}
            title="字号 -"
          >A-</button>
          <button
            data-testid="dictionary-card-font-up"
            onClick={() => onFontSizeChange(1)}
            style={btnStyle}
            title="字号 +"
          >A+</button>
          <span style={{ flex: 1 }} />
          <button
            data-testid="dictionary-card-glossary"
            onClick={onOpenGlossary}
            style={btnStyle}
            title="打开术语库"
          >📚 术语库</button>
          <button
            data-testid="dictionary-card-copy"
            onClick={onCopy}
            style={btnStyle}
            title="复制译文"
          >📋 复制</button>
          <button
            data-testid="dictionary-card-retranslate"
            onClick={onRetranslate}
            style={{ ...btnStyle, background: 'var(--color-primary)', color: 'var(--color-text-inverse)' }}
            title="重新翻译 (⌘+Enter)"
          >↻ 重译</button>
        </div>
      </div>
    </>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--color-bg-subtle)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  cursor: 'pointer',
}
