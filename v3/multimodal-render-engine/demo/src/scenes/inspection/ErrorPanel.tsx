import React, { useRef, useEffect } from 'react'
import type { Annotation, AnnotationType } from '../../core/types'
import { CATEGORY_COLOR } from '../../layers/SVGLayer'

type FilterTab = '全部' | '拼写' | '语法' | '标点' | '数字' | '涉政'

const TAB_TYPE_MAP: Record<FilterTab, AnnotationType | null> = {
  '全部': null,
  '拼写': 'error-spelling',
  '语法': 'error-grammar',
  '标点': 'error-punctuation',
  '数字': 'error-number',
  '涉政': 'error-political',
}

const TYPE_LABEL: Record<AnnotationType, string> = {
  'error-spelling': '拼写',
  'error-grammar': '语法',
  'error-punctuation': '标点',
  'error-number': '数字',
  'error-political': '涉政',
  'ocr-region': 'OCR',
  'ocr-field': '字段',
  'translation-paragraph': '翻译',
}

interface ErrorPanelProps {
  annotations: Annotation[]
  activeId: string | null
  onAccept: (id: string) => void
  onIgnore: (id: string) => void
  onFocus: (id: string) => void
}

export const ErrorPanel: React.FC<ErrorPanelProps> = ({
  annotations,
  activeId,
  onAccept,
  onIgnore,
  onFocus,
}) => {
  const [activeTab, setActiveTab] = React.useState<FilterTab>('全部')
  const activeCardRef = useRef<HTMLDivElement>(null)

  const errorAnnotations = annotations.filter(a =>
    a.type.startsWith('error-')
  )

  // Count per type (active only)
  const counts: Partial<Record<AnnotationType, number>> = {}
  errorAnnotations.forEach(a => {
    if (a.status === 'active') {
      counts[a.type] = (counts[a.type] ?? 0) + 1
    }
  })

  const filterType = TAB_TYPE_MAP[activeTab]
  const filtered = errorAnnotations.filter(a => {
    if (filterType !== null && a.type !== filterType) return false
    return true
  })

  // Auto-scroll active card into view
  useEffect(() => {
    if (activeCardRef.current) {
      activeCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeId])

  const tabs: FilterTab[] = ['全部', '拼写', '语法', '标点', '数字', '涉政']

  return (
    <div style={{
      width: 280,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid #f0f0f0',
      background: '#fafafa',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Stats bar */}
      <div style={{
        padding: '12px 16px 8px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fff',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 8 }}>
          校对结果
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['error-spelling', 'error-grammar', 'error-punctuation', 'error-number', 'error-political'] as AnnotationType[]).map(type => {
            const count = counts[type] ?? 0
            return (
              <span key={type} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 10,
                background: count > 0 ? `${CATEGORY_COLOR[type]}18` : '#f5f5f5',
                fontSize: 12,
                color: count > 0 ? CATEGORY_COLOR[type] : '#bbb',
              }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: CATEGORY_COLOR[type],
                  display: 'inline-block',
                  opacity: count > 0 ? 1 : 0.35,
                }} />
                {TYPE_LABEL[type]} {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #f0f0f0',
        background: '#fff',
        overflowX: 'auto',
        flexShrink: 0,
      }}>
        {tabs.map(tab => {
          const isActive = tab === activeTab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: '0 0 auto',
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                color: isActive ? '#1890ff' : '#666',
                borderBottom: isActive ? '2px solid #1890ff' : '2px solid transparent',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {/* Error card list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#bbb', fontSize: 13, padding: '40px 0' }}>
            暂无错误
          </div>
        )}
        {filtered.map(ann => {
          const isAccepted = ann.status === 'accepted'
          const isIgnored = ann.status === 'ignored'
          const isActive = ann.id === activeId
          const color = CATEGORY_COLOR[ann.type]

          return (
            <div
              key={ann.id}
              ref={isActive ? activeCardRef : undefined}
              onClick={() => onFocus(ann.id)}
              style={{
                margin: '4px 8px',
                padding: '10px 12px',
                borderRadius: 6,
                background: isAccepted ? 'transparent' : '#fff',
                border: isActive
                  ? `2px solid ${color}`
                  : '2px solid #f0f0f0',
                cursor: 'pointer',
                opacity: isIgnored ? 0.45 : isAccepted ? 0.3 : 1,
                transition: 'border-color 0.15s, opacity 0.15s',
                display: isAccepted ? 'none' : undefined,
              }}
            >
              {/* Type badge + original */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <span style={{
                  flexShrink: 0,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: `${color}20`,
                  color,
                  fontSize: 11,
                  fontWeight: 600,
                }}>
                  {TYPE_LABEL[ann.type]}
                </span>
                <span style={{
                  fontSize: 13,
                  color: '#333',
                  lineHeight: 1.5,
                  wordBreak: 'break-all',
                }}>
                  <span style={{
                    background: `${color}25`,
                    borderBottom: `2px solid ${color}`,
                    padding: '0 1px',
                  }}>
                    {ann.content.original}
                  </span>
                </span>
              </div>

              {/* Suggestion */}
              {ann.content.suggestion && (
                <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 8 }}>
                  建议：{ann.content.suggestion}
                </div>
              )}

              {/* Action buttons */}
              {!isIgnored && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={e => { e.stopPropagation(); onAccept(ann.id) }}
                    style={{
                      padding: '3px 10px',
                      border: `1px solid ${color}`,
                      borderRadius: 4,
                      background: color,
                      color: '#fff',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    接受
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onIgnore(ann.id) }}
                    style={{
                      padding: '3px 10px',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                      background: '#fff',
                      color: '#666',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    忽略
                  </button>
                </div>
              )}
              {isIgnored && (
                <div style={{ fontSize: 12, color: '#aaa' }}>已忽略</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
