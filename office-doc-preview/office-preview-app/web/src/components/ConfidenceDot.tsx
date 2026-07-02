// ConfidenceDot — 置信度颜色圆点（设计 token 化）
// 模型：claude-sonnet-4-6
import React from 'react'

interface Props {
  confidence: number  // 0..1
  size?: number  // default 8
  showValue?: boolean  // default false; if true show "92%"
}

/** 选择置信度对应语义色（高/中/低 3 档） */
function colorForConfidence(c: number): string {
  if (c >= 0.9) return 'var(--color-success)'
  if (c >= 0.7) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

/**
 * 置信度颜色点
 * - 默认 8×8 px
 * - showValue=true 时右侧带 "92%" 文字
 * - 颜色阈值: >= 0.9 绿 / >= 0.7 琥珀 / < 0.7 红
 */
export function ConfidenceDot({ confidence, size = 8, showValue = false }: Props) {
  const bg = colorForConfidence(confidence)
  const pct = Math.round((confidence || 0) * 100)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} data-confidence-dot="true">
      <span
        data-testid="confidence-dot"
        data-level={confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'mid' : 'low'}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          borderRadius: '50%',
          background: bg,
          flexShrink: 0,
        }}
        aria-label={`置信度 ${pct}%`}
      />
      {showValue && (
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }} data-testid="confidence-dot-value">
          {pct}%
        </span>
      )}
    </span>
  )
}
