// 模型：claude-sonnet-4-6
// AnnotationChip — small badge for inline annotation display
//
// Color per kind from semantic tokens:
//   - align_fix → var(--color-annotation-kind-align) = blue-6
//   - seg_rating → var(--color-annotation-kind-seg)   = green-6
//   - alt_trans → var(--color-annotation-kind-alt)   = purple-6
// data-testid: oa-annotation-chip-{kind}
// ClassName: .oa-annotation-chip .oa-annotation-chip-kind-{align|seg|alt} .is-active

import { MouseEvent } from 'react'
import type { AnnotationKind } from '../types'

export interface AnnotationChipProps {
  kind: AnnotationKind
  count?: number
  segmentId?: string
  onClick?: () => void
  active?: boolean
}

function kindClass(kind: AnnotationKind): string {
  switch (kind) {
    case 'align_fix': return 'oa-annotation-chip-kind-align'
    case 'seg_rating': return 'oa-annotation-chip-kind-seg'
    case 'alt_trans': return 'oa-annotation-chip-kind-alt'
  }
}

function kindLabel(kind: AnnotationKind): string {
  switch (kind) {
    case 'align_fix': return '对齐修正'
    case 'seg_rating': return '段落评分'
    case 'alt_trans': return '备选翻译'
  }
}

function kindToken(kind: AnnotationKind): string {
  switch (kind) {
    case 'align_fix': return 'var(--color-annotation-kind-align)'
    case 'seg_rating': return 'var(--color-annotation-kind-seg)'
    case 'alt_trans': return 'var(--color-annotation-kind-alt)'
  }
}

export function AnnotationChip({
  kind,
  count,
  segmentId,
  onClick,
  active,
}: AnnotationChipProps) {
  const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    const ts = new Date().toISOString()
    console.info(
      `[translate-annotation ${ts}] action=chip kind=${kind} segId=${segmentId ?? ''}`,
    )
    onClick?.()
  }

  const showBadge = typeof count === 'number' && count > 1
  const classes = [
    'oa-annotation-chip',
    kindClass(kind),
    active ? 'is-active' : '',
  ].filter(Boolean).join(' ')

  const ariaLabel = segmentId
    ? `${kindLabel(kind)} 标注 ${segmentId}${showBadge ? ` (${count})` : ''}`
    : `${kindLabel(kind)} 标注${showBadge ? ` (${count})` : ''}`

  return (
    <span
      role="button"
      tabIndex={onClick ? 0 : -1}
      aria-label={ariaLabel}
      data-testid={`oa-annotation-chip-${kind}`}
      data-kind={kind}
      data-segment={segmentId ?? ''}
      className={classes}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        background: kindToken(kind),
        color: 'var(--color-text-inverse)',
        border: active ? '2px solid var(--color-text)' : '2px solid transparent',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick(e as unknown as MouseEvent<HTMLSpanElement>)
        }
      }}
    >
      <span className="oa-annotation-chip-label">{kindLabel(kind)}</span>
      {showBadge && (
        <span
          className="oa-annotation-chip-badge"
          data-testid="oa-annotation-chip-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 999,
            background: 'var(--color-bg)',
            color: kindToken(kind),
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      )}
    </span>
  )
}