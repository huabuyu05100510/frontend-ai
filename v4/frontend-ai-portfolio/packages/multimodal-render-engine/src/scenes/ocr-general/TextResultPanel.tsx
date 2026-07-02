/**
 * OCR 文字结果面板
 *
 * 按识别顺序展示文字块，支持双向 hover 联动、全文复制、单条复制。
 * 低置信度条目 opacity 降低 + ⚠️ 图标。
 *
 * @module scenes/ocr-general/TextResultPanel
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { Annotation } from '../../core/types';
import { toast } from '../../components/Toast';

interface TextResultPanelProps {
  regions: Annotation[];
  activeId: string | null;
  onHover: (id: string | null) => void;
}

/**
 * 文字结果面板
 */
export const TextResultPanel: React.FC<TextResultPanelProps> = ({
  regions,
  activeId,
  onHover,
}) => {
  const activeRef = useRef<HTMLDivElement>(null);
  const [hoveredCopy, setHoveredCopy] = React.useState<string | null>(null);

  // activeId 变化时自动滚动
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  const handleCopyAll = useCallback(async () => {
    const fullText = regions
      .sort((a, b) => ((a.meta as any)?.order ?? 0) - ((b.meta as any)?.order ?? 0))
      .map(r => r.content.original)
      .join('\n');

    try {
      await navigator.clipboard.writeText(fullText);
      toast.success('已复制全文');
    } catch {
      toast.error('复制失败');
    }
  }, [regions]);

  const handleCopySingle = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制');
    } catch {
      toast.error('复制失败');
    }
  }, []);

  if (regions.length === 0) {
    return (
      <div style={{
        width: '320px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        borderLeft: '1px solid #e8e8e8',
      }}>
        暂无识别结果
      </div>
    );
  }

  return (
    <div
      style={{
        width: '320px',
        borderLeft: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0',
        fontSize: '14px',
        fontWeight: 500,
      }}>
        <span>识别结果 ({regions.length})</span>
        <button
          onClick={handleCopyAll}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid #d9d9d9',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '12px',
            color: '#666',
          }}
        >
          复制全文
        </button>
      </div>

      {/* 结果列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {regions
          .sort((a, b) => ((a.meta as any)?.order ?? 0) - ((b.meta as any)?.order ?? 0))
          .map((region, idx) => {
            const isLowConfidence = (region.content.confidence ?? 1) < 0.3;
            const isActive = activeId === region.id;

            return (
              <div
                key={region.id}
                ref={isActive ? activeRef : undefined}
                data-id={region.id}
                onMouseEnter={() => onHover(region.id)}
                onMouseLeave={() => onHover(null)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '10px 12px',
                  marginBottom: '4px',
                  borderRadius: '6px',
                  border: isActive ? '1px solid #1890ff' : '1px solid transparent',
                  background: isActive ? '#e6f7ff' : 'transparent',
                  opacity: isLowConfidence ? 0.4 : 1,
                  cursor: 'pointer',
                  transition: 'background 150ms ease',
                }}
              >
                {/* 序号 */}
                <span style={{
                  color: '#1890ff',
                  fontWeight: 600,
                  fontSize: '13px',
                  minWidth: '24px',
                }}>
                  {(idx + 1).toString().padStart(2, '0')}
                </span>

                {/* 文字 */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', lineHeight: '1.6', wordBreak: 'break-all' }}>
                    {region.content.original}
                  </div>
                  {isLowConfidence && (
                    <span title="识别置信度较低" style={{ fontSize: '16px' }}>⚠️</span>
                  )}
                </div>

                {/* 复制图标（hover 时显示） */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopySingle(region.content.original);
                  }}
                  style={{
                    opacity: hoveredCopy === region.id ? 1 : 0,
                    padding: '2px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#999',
                  }}
                  onMouseEnter={() => setHoveredCopy(region.id)}
                  onMouseLeave={() => setHoveredCopy(null)}
                  title="复制"
                >
                  📋
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
};

TextResultPanel.displayName = 'TextResultPanel';