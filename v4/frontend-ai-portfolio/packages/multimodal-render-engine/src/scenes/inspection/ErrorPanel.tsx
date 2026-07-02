/**
 * 智检错误面板
 *
 * 展示错误卡片列表，支持分类筛选、Accept / Ignore 操作、键盘导航。
 *
 * @module scenes/inspection/ErrorPanel
 */

import React, { useRef, useEffect, useMemo, useState } from 'react';
import type { Annotation, AnnotationType } from '../../core/types';
import { CATEGORY_COLOR } from '../../core/types';

interface ErrorPanelProps {
  annotations: Annotation[];
  activeId: string | null;
  onAccept: (id: string) => void;
  onIgnore: (id: string) => void;
  onFocus: (id: string) => void;
}

const ERROR_TYPES: Array<{ type: string; label: string }> = [
  { type: 'all', label: '全部' },
  { type: 'error-spelling', label: '拼写' },
  { type: 'error-grammar', label: '语法' },
  { type: 'error-punctuation', label: '标点' },
  { type: 'error-number', label: '数字' },
  { type: 'error-political', label: '涉政' },
];

/**
 * 错误面板组件
 */
export const ErrorPanel: React.FC<ErrorPanelProps> = ({
  annotations,
  activeId,
  onAccept,
  onIgnore,
  onFocus,
}) => {
  const [filter, setFilter] = useState<string>('all');
  const activeRef = useRef<HTMLLIElement>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return annotations;
    return annotations.filter(a => a.type === filter);
  }, [annotations, filter]);

  // 按类型统计
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of annotations) {
      map[a.type] = (map[a.type] || 0) + 1;
    }
    return map;
  }, [annotations]);

  // activeId 变化时自动滚动
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  const totalCount = annotations.length;

  return (
    <div
      role="complementary"
      aria-label="错误列表面板"
      style={{
        width: '280px',
        borderLeft: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
      }}
    >
      {/* 统计栏 */}
      <div
        role="status"
        aria-live="polite"
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        共检测到 {totalCount} 个错误
      </div>

      {/* 分类筛选 */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
      }}>
        {ERROR_TYPES.map(({ type, label }) => {
          const count = type === 'all' ? totalCount : (counts[type] || 0);
          const color = type === 'all' ? '#666' : CATEGORY_COLOR[type as AnnotationType];
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              style={{
                padding: '2px 8px',
                borderRadius: '10px',
                border: filter === type ? `1px solid ${color}` : '1px solid #e8e8e8',
                background: filter === type ? `${color}15` : '#fff',
                color: filter === type ? color : '#666',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {label} {count}
            </button>
          );
        })}
      </div>

      {/* 错误卡片列表 */}
      <ul style={{
        flex: 1,
        overflow: 'auto',
        margin: 0,
        padding: '8px',
        listStyle: 'none',
      }}>
        {filtered.map(ann => {
          const color = CATEGORY_COLOR[ann.type];
          const isActive = activeId === ann.id;
          const isIgnored = ann.status === 'ignored';

          return (
            <li
              key={ann.id}
              ref={isActive ? activeRef : undefined}
              tabIndex={0}
              role="listitem"
              aria-label={`${ann.type}：${ann.content.original}${ann.content.suggestion ? `，建议替换为 ${ann.content.suggestion}` : ''}`}
              onClick={() => onFocus(ann.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onFocus(ann.id);
              }}
              style={{
                padding: '10px 12px',
                marginBottom: '6px',
                borderRadius: '6px',
                border: isActive ? `2px solid ${color}` : '1px solid #f0f0f0',
                background: isActive ? `${color}08` : '#fff',
                opacity: isIgnored ? 0.5 : 1,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {/* 错误文本 */}
              <div style={{
                fontWeight: 500,
                marginBottom: '4px',
                textDecoration: isIgnored ? 'none' : 'underline',
                textDecorationColor: color,
                textDecorationStyle: 'wavy',
                textUnderlineOffset: '4px',
              }}>
                {ann.content.original}
              </div>

              {/* 类型标签 + 建议 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{
                  fontSize: '11px',
                  padding: '0 6px',
                  borderRadius: '3px',
                  background: `${color}20`,
                  color,
                }}>
                  {ERROR_TYPES.find(t => t.type === ann.type)?.label ?? ann.type}
                </span>
                {ann.content.suggestion && (
                  <span style={{ color: '#999', fontSize: '12px' }}>
                    → {ann.content.suggestion}
                  </span>
                )}
              </div>

              {/* 操作按钮 */}
              {ann.status !== 'ignored' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  {ann.content.suggestion && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAccept(ann.id); }}
                      style={{
                        padding: '2px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#1890ff',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      接受
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onIgnore(ann.id); }}
                    style={{
                      padding: '2px 12px',
                      borderRadius: '4px',
                      border: '1px solid #d9d9d9',
                      background: '#fff',
                      color: '#666',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    忽略
                  </button>
                </div>
              )}
            </li>
          );
        })}

        {filtered.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#999',
          }}>
            未发现错误
          </div>
        )}
      </ul>
    </div>
  );
};

ErrorPanel.displayName = 'ErrorPanel';