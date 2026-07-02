// 模型：claude-sonnet-4-6
// AnnotationList — vertical list of annotations with filter pills
//
// Filter pills: All / 对齐修正 / 段落评分 / 备选翻译
// Each row: AnnotationChip + segId + relative time + actions (jump / delete)
// Empty state: "暂无标注，点 + 添加"

import { useMemo, useState } from 'react'
import { useAnnotation } from '../hooks/useAnnotation'
import { AnnotationChip } from './AnnotationChip'
import type { AnnotationKind, TranslateAnnotation } from '../types'

export interface AnnotationListProps {
  taskId: string
  segmentId?: string
  onSelect?: (ann: TranslateAnnotation) => void
  onAdd?: (kind: AnnotationKind) => void
}

type FilterKind = 'all' | AnnotationKind

const FILTERS: Array<{ key: FilterKind; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'align_fix', label: '对齐修正' },
  { key: 'seg_rating', label: '段落评分' },
  { key: 'alt_trans', label: '备选翻译' },
]

function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 1000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function summaryText(ann: TranslateAnnotation): string {
  const p = ann.payload as Record<string, unknown> | null
  if (!p) return ''
  if (typeof p.text === 'string') return p.text
  if (typeof p.comment === 'string') return p.comment
  if (typeof p.rating === 'number') return `评分 ${p.rating}/5`
  if (Array.isArray(p.srcIndex) || typeof p.srcIndex === 'number') return '对齐修正'
  return ''
}

export function AnnotationList({ taskId, segmentId, onSelect, onAdd }: AnnotationListProps) {
  const { items, loading, error, removeAnnotation } = useAnnotation(taskId)
  const [filter, setFilter] = useState<FilterKind>('all')

  const visible = useMemo(() => {
    let list = items
    if (segmentId) list = list.filter(a => a.segmentId === segmentId)
    if (filter !== 'all') list = list.filter(a => a.kind === filter)
    return list
  }, [items, segmentId, filter])

  const countByKind = useMemo(() => {
    const m: Record<AnnotationKind, number> = { align_fix: 0, seg_rating: 0, alt_trans: 0 }
    for (const a of items) m[a.kind]++
    return m
  }, [items])

  const handleFilter = (k: FilterKind) => {
    setFilter(k)
    const ts = new Date().toISOString()
    const showing = k === 'all' ? items.length : countByKind[k as AnnotationKind]
    console.info(
      `[translate-annotation ${ts}] action=list-filter kind=${k} task=${taskId} showing=${showing} note=list filter`,
    )
  }

  const handleDelete = async (id: string) => {
    await removeAnnotation(id)
  }

  return (
    <div
      className="oa-annotation-list-wrap"
      data-task-id={taskId}
      data-testid="oa-annotation-list"
      role="list"
    >
      {/* Filter pills */}
      <div className="oa-annotation-list-filters" role="tablist" aria-label="标注过滤">
        {FILTERS.map(f => {
          const count = f.key === 'all' ? items.length : countByKind[f.key as AnnotationKind]
          const active = filter === f.key
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`oa-annotation-list-filter-${f.key}`}
              data-active={active ? 'true' : 'false'}
              className={`oa-annotation-list-filter ${active ? 'is-active' : ''}`}
              onClick={() => handleFilter(f.key)}
              style={{
                padding: '4px 10px',
                marginRight: 6,
                marginBottom: 6,
                borderRadius: 999,
                border: '1px solid var(--color-border)',
                background: active ? 'var(--color-primary)' : 'var(--color-bg)',
                color: active ? 'var(--color-text-inverse)' : 'var(--color-text)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {f.label}
              {count > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.85 }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div data-testid="oa-annotation-list-loading" className="oa-annotation-list-loading"
          style={{ padding: 16, color: 'var(--color-text-tertiary)', fontSize: 13 }}
        >
          加载中…
        </div>
      )}

      {/* Error state */}
      {error && (
        <div data-testid="oa-annotation-list-error" className="oa-annotation-list-error"
          style={{ padding: 12, color: 'var(--color-danger)', fontSize: 13, background: 'var(--color-danger-bg)', borderRadius: 6 }}
        >
          加载标注失败：{error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visible.length === 0 && (
        <div
          data-testid="oa-annotation-list-empty"
          className="oa-annotation-list-empty"
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 13,
            border: '1px dashed var(--color-border-light)',
            borderRadius: 8,
          }}
        >
          暂无标注
          {onAdd && (
            <button
              type="button"
              data-testid="oa-annotation-list-empty-add"
              onClick={() => onAdd(filter === 'all' ? 'alt_trans' : filter)}
              style={{
                display: 'block',
                margin: '12px auto 0',
                padding: '6px 14px',
                border: 'none',
                background: 'var(--color-primary)',
                color: 'var(--color-text-inverse)',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              + 添加标注
            </button>
          )}
        </div>
      )}

      {/* List */}
      {visible.length > 0 && (
        <ul
          role="list"
          data-testid="oa-annotation-list"
          className="oa-annotation-list"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {visible.map(a => (
            <li
              key={a.id}
              data-testid={`oa-annotation-list-row-${a.id}`}
              data-kind={a.kind}
              data-segment={a.segmentId}
              className="oa-annotation-list-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderBottom: '1px solid var(--color-border-light)',
                cursor: onSelect ? 'pointer' : 'default',
              }}
              onClick={() => onSelect?.(a)}
            >
              <AnnotationChip kind={a.kind} />
              <span
                data-testid={`oa-annotation-list-row-${a.id}-seg`}
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {a.segmentId}
              </span>
              <span
                data-testid={`oa-annotation-list-row-${a.id}-summary`}
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {summaryText(a)}
              </span>
              <span
                data-testid={`oa-annotation-list-row-${a.id}-time`}
                style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}
              >
                {relativeTime(a.updatedAt)}
              </span>
              <button
                type="button"
                data-testid={`oa-annotation-list-row-${a.id}-delete`}
                aria-label="删除标注"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(a.id)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-danger)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}