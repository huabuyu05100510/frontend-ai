// ImageDualView — 三视图：overlay / stacked / original
// 模型：claude-sonnet-4-6
import React from 'react'
import type { OCRRegion } from '../types'
import { ImageRegionSvgOverlay } from './ImageRegionSvgOverlay'

interface Props {
  imageSrc: string
  imageSize: { width: number; height: number }
  regions: OCRRegion[]
  translations: Record<number, string>  // regionIdx → 译文
  selectedIdx: number | null
  hoveredIdx: number | null
  viewMode: 'overlay' | 'stacked' | 'original'
  onSelectRegion: (idx: number | null) => void
  onHoverRegion: (idx: number | null) => void
  onCopyAll: () => void
  onSaveBilingual: () => void
}

/**
 * 图片双视图（核心可视化层）
 * - overlay: <img> 绝对定位 + <ImageRegionSvgOverlay> 叠加
 * - stacked: <img> + 翻译列表（双列排版）
 * - original: 仅 <img>
 */
export function ImageDualView({
  imageSrc,
  imageSize,
  regions,
  translations,
  selectedIdx,
  hoveredIdx,
  viewMode,
  onSelectRegion,
  onHoverRegion,
  onCopyAll,
  onSaveBilingual,
}: Props) {
  const hasImage = !!imageSrc

  // 工具栏（始终显示）
  const toolbar = (
    <div
      data-testid="image-dual-toolbar"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'var(--color-bg-subtle)',
        borderBottom: '1px solid var(--color-border-light)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--color-text-tertiary)' }}>视图：</span>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{viewMode === 'overlay' ? '叠加' : viewMode === 'stacked' ? '并排' : '原图'}</span>
      <span style={{ flex: 1 }} />
      <button
        data-testid="image-dual-copy-all"
        onClick={onCopyAll}
        style={btnStyle}
        title="复制全部译文到剪贴板"
      >📋 复制全部</button>
      <button
        data-testid="image-dual-save-bilingual"
        onClick={onSaveBilingual}
        style={btnStyle}
        title="保存双语图（PNG）"
      >💾 保存双语图</button>
    </div>
  )

  if (viewMode === 'stacked') {
    return (
      <div data-testid="image-dual-stacked" className="image-dual-stack" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {toolbar}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {hasImage && (
            <div style={{ marginBottom: 16, textAlign: 'center' }}>
              <img
                data-testid="image-dual-img"
                src={imageSrc}
                alt="原图"
                style={{ maxWidth: '100%', maxHeight: 360, display: 'inline-block' }}
              />
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text)' }}>
              区域翻译
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {regions.map((r, i) => {
                const tr = translations[i]
                return (
                  <div
                    key={i}
                    data-testid={`stack-item-${i}`}
                    data-selected={selectedIdx === i}
                    onClick={() => onSelectRegion(i)}
                    style={{
                      padding: 10,
                      background: selectedIdx === i ? 'var(--color-primary-bg)' : 'var(--color-bg-subtle)',
                      border: '1px solid ' + (selectedIdx === i ? 'var(--color-primary)' : 'var(--color-border-light)'),
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{
                        background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
                        fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                      }}>#{i + 1}</span>
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
                        置信度 {Math.round((r.confidence || 0) * 100)}%
                      </span>
                    </div>
                    <div style={{ color: 'var(--color-text-secondary)', marginBottom: 2 }}>{r.text || '(空)'}</div>
                    <div style={{ color: tr ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
                      {tr || '⏳ 翻译中…'}
                    </div>
                  </div>
                )
              })}
              {regions.length === 0 && (
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12, textAlign: 'center', padding: 24 }}>
                  暂未识别。请先点击「识别」按钮。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (viewMode === 'original') {
    return (
      <div data-testid="image-dual-original" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {toolbar}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {hasImage ? (
            <img
              data-testid="image-dual-img"
              src={imageSrc}
              alt="原图"
              style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
            />
          ) : (
            <div style={{ color: 'var(--color-text-tertiary)' }}>无图片</div>
          )}
        </div>
      </div>
    )
  }

  // overlay 模式（默认）
  return (
    <div data-testid="image-dual-overlay" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {toolbar}
      <div
        data-testid="image-dual-stage"
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'auto',
          background: 'var(--color-bg-canvas)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        {hasImage ? (
          <div
            data-testid="image-dual-canvas"
            style={{
              position: 'relative',
              display: 'inline-block',
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            <img
              data-testid="image-dual-img"
              src={imageSrc}
              alt="原图"
              style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block' }}
            />
            {imageSize.width > 0 && imageSize.height > 0 && regions.length > 0 && (
              <ImageRegionSvgOverlay
                regions={regions}
                imageSize={imageSize}
                hoveredIdx={hoveredIdx}
                selectedIdx={selectedIdx}
                onHover={onHoverRegion}
                onClick={onSelectRegion}
              />
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }}>请选择图片任务</div>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  cursor: 'pointer',
}
