// 模型：claude-sonnet-4-6
// ImagePreviewPane — 图片预览面板（zoom + grid + region overlay + status bar）
//
// 图片源: GET /api/inspect/translate/render-image?task=…&page=…
// zoom:   CSS transform: scale(zoom) on stage wrapper
// grid:   4×4 网格（绝对定位 overlay，可开关）
// region: OCRRegion[] 渲染为 SVG <rect>（hover 回调）
// 日志:   [translate-ui ISO] image-preview task=… zoom=… grid=…

import React, { useEffect, useState } from 'react'
import type { OCRRegion } from '../types'

export interface ImagePreviewPaneProps {
  taskId: string
  page?: number          // default 1
  zoom?: number          // 0.5..3, default 1
  showGrid?: boolean     // default false
  regions?: OCRRegion[]
  onRegionHover?: (id: string | null) => void
  className?: string
}

/** confidence → stroke color (与 ImageRegionSvgOverlay 一致) */
function colorForConfidence(c: number): string {
  if (c >= 0.9) return 'var(--color-success)'
  if (c >= 0.7) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

/**
 * 图片预览面板
 *
 * - src: /api/inspect/translate/render-image?task=…&page=…
 * - zoom: 受控或内部 state；canvas 应用 transform: scale()
 * - showGrid: 4×4 网格绝对定位 overlay
 * - status bar: "缩放 120% · 网格 关闭 · 第 2 页"
 * - regions: SVG <rect> 叠加层 + hover 回调（id 为字符串化 idx）
 */
export function ImagePreviewPane({
  taskId,
  page = 1,
  zoom: zoomProp,
  showGrid: showGridProp,
  regions,
  onRegionHover,
  className,
}: ImagePreviewPaneProps) {
  const isControlledZoom = zoomProp !== undefined
  const isControlledGrid = showGridProp !== undefined
  const [internalZoom, setInternalZoom] = useState<number>(zoomProp ?? 1)
  const [internalGrid, setInternalGrid] = useState<boolean>(showGridProp ?? false)

  const zoom = isControlledZoom ? (zoomProp as number) : internalZoom
  const showGrid = isControlledGrid ? (showGridProp as boolean) : internalGrid

  const src = `/api/inspect/translate/render-image?task=${encodeURIComponent(taskId)}&page=${page}`

  // 内部状态 (受控回退)
  function handleZoomChange(next: number) {
    if (!isControlledZoom) setInternalZoom(next)
  }
  function toggleGrid() {
    if (!isControlledGrid) setInternalGrid((v) => !v)
  }

  // 日志：参数变更时打印
  useEffect(() => {
    console.info(
      `[translate-ui ${new Date().toISOString()}] image-preview task=${taskId} zoom=${zoom.toFixed(1)} grid=${showGrid ? 'on' : 'off'}`,
    )
  }, [taskId, zoom, showGrid])

  return (
    <div
      data-testid="oa-image-preview"
      className={`oa-image-preview ${className ?? ''}`.trim()}
    >
      <div className="oa-image-preview-toolbar">
        <label className="oa-image-preview-zoom-label">
          <span className="oa-image-preview-zoom-text">缩放</span>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={zoom}
            data-testid="oa-image-preview-zoom"
            className="oa-image-preview-zoom"
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            aria-label="图片缩放"
          />
          <span className="oa-image-preview-zoom-value">{Math.round(zoom * 100)}%</span>
        </label>

        <button
          type="button"
          data-testid="oa-image-preview-grid-toggle"
          className={`oa-image-preview-grid-toggle ${showGrid ? 'is-active' : ''}`}
          onClick={toggleGrid}
          aria-pressed={showGrid}
        >
          网格 {showGrid ? '开' : '关'}
        </button>
      </div>

      <div className="oa-image-preview-canvas">
        <div
          className="oa-image-preview-stage"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        >
          <img
            src={src}
            alt="原图预览"
            loading="lazy"
            decoding="async"
            className="oa-image-preview-img"
            draggable={false}
          />
          {showGrid && (
            <div
              data-testid="oa-image-preview-grid-overlay"
              className="oa-image-preview-grid"
              aria-hidden="true"
            />
          )}
          {regions && regions.length > 0 && (
            <svg
              data-testid="oa-image-preview-region-overlay"
              className="oa-image-preview-region-overlay"
              // viewBox 用图像"标称"尺寸 (此处保守取 1000×1000)；容器用 CSS 缩放与 img 一致
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              onMouseLeave={() => onRegionHover?.(null)}
            >
              {regions.map((r, idx) => {
                // 假设 OCRRegion 是相对图像像素坐标；归一化到 viewBox 0..1000
                const normX = Math.max(0, Math.min(1000, r.x))
                const normY = Math.max(0, Math.min(1000, r.y))
                const normW = Math.max(1, Math.min(1000 - normX, r.width))
                const normH = Math.max(1, Math.min(1000 - normY, r.height))
                return (
                  <rect
                    key={idx}
                    data-testid={`oa-image-preview-region-rect-${idx}`}
                    data-region-id={String(idx)}
                    x={normX}
                    y={normY}
                    width={normW}
                    height={normH}
                    fill="transparent"
                    stroke={colorForConfidence(r.confidence)}
                    strokeWidth={1.5}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onMouseEnter={() => onRegionHover?.(String(idx))}
                  >
                    <title>{r.text} ({(r.confidence * 100).toFixed(0)}%)</title>
                  </rect>
                )
              })}
            </svg>
          )}
        </div>
      </div>

      <div
        data-testid="oa-image-preview-status"
        className="oa-image-preview-status"
        role="status"
      >
        缩放 {Math.round(zoom * 100)}% · 网格 {showGrid ? '开' : '关'} · 第 {page} 页
      </div>
    </div>
  )
}