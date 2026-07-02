// ImageRegionSvgOverlay — 复用 OCRPage SVG bbox 渲染模式
// 模型：claude-sonnet-4-6
import React from 'react'
import type { OCRRegion } from '../types'

interface Props {
  regions: OCRRegion[]
  imageSize: { width: number; height: number }
  hoveredIdx: number | null
  selectedIdx: number | null
  onHover: (idx: number | null) => void
  onClick: (idx: number) => void
  showLabels?: boolean  // default true
  scanLine?: boolean  // default true
  motionEnabled?: boolean  // default true
  /** testId 前缀；默认 'region-'，OCRPage 传 'ocr-region-' 复用测试 */
  testIdPrefix?: string
  /** SVG data-testid；默认 'image-dual-svg' */
  svgTestId?: string
}

/** 置信度颜色阈值（与 OCRPage 一致） */
function colorForConfidence(c: number): { stroke: string; fill: string } {
  if (c >= 0.9) {
    return { stroke: 'var(--color-success)', fill: 'var(--color-success-bg)' }
  }
  if (c >= 0.7) {
    return { stroke: 'var(--color-warning)', fill: 'var(--color-warning-bg)' }
  }
  return { stroke: 'var(--color-danger)', fill: 'var(--color-danger-bg)' }
}

/**
 * SVG bbox 叠加层（imageSize 决定 viewBox，1:1 像素）
 * - rect: confidence-based stroke + 半透明 fill
 * - <title>: 浏览器原生 tooltip (区域文字 + 置信度)
 * - 序号 #i 标签 (rect width > 30 时)
 * - 选中/hover: stroke=primary, strokeWidth=3
 * - scan-line: 1.2s 循环扫描动画 (data-motion="off" 时停止)
 */
export function ImageRegionSvgOverlay({
  regions,
  imageSize,
  hoveredIdx,
  selectedIdx,
  onHover,
  onClick,
  showLabels = true,
  scanLine = true,
  motionEnabled = true,
  testIdPrefix = 'region-',
  svgTestId = 'image-dual-svg',
}: Props) {
  // 尊重 prefers-reduced-motion（与项目内其他组件一致）
  const motionOff =
    !motionEnabled ||
    (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'off')

  const vbW = imageSize.width
  const vbH = imageSize.height
  const scanId = 'image-region-scanline'

  return (
    <svg
      data-testid={svgTestId}
      data-motion-aware={motionOff ? 'off' : 'on'}
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <defs>
        <linearGradient id={scanId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--color-primary)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {regions.map((reg, i) => {
        const c = reg.confidence || 0.9
        const { stroke, fill } = colorForConfidence(c)
        const isHovered = hoveredIdx === i
        const isSelected = selectedIdx === i
        const activeStroke = 'var(--color-primary)'
        const activeFill = 'var(--color-primary-bg)'
        return (
          <g key={i} data-region-idx={i} style={{ pointerEvents: 'auto' }}>
            <rect
              data-testid={`${testIdPrefix}rect-${i}`}
              x={reg.x}
              y={reg.y}
              width={reg.width}
              height={reg.height}
              fill={isHovered || isSelected ? activeFill : fill}
              stroke={isHovered || isSelected ? activeStroke : stroke}
              strokeWidth={isHovered || isSelected ? 3 : 1.5}
              rx={2}
              style={{ cursor: 'pointer', transition: 'fill 120ms, stroke 120ms' }}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(i)}
            >
              <title>{`${reg.text || '(空)'} · 置信度 ${Math.round(c * 100)}%`}</title>
            </rect>
            {showLabels && reg.width > 30 && (
              <text
                data-testid={`${testIdPrefix}label-${i}`}
                x={reg.x + 4}
                y={reg.y + 14}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fill: 'var(--color-text-inverse)',
                  stroke: isHovered || isSelected ? activeStroke : stroke,
                  strokeWidth: 3,
                  paintOrder: 'stroke fill',
                  pointerEvents: 'none',
                }}
              >
                #{i + 1}
              </text>
            )}
          </g>
        )
      })}

      {scanLine && (
        <rect
          data-testid="scan-line"
          data-motion-aware={motionOff ? 'off' : 'on'}
          x={0}
          y={0}
          width={vbW * 0.2}
          height={vbH}
          fill={`url(#${scanId})`}
          pointerEvents="none"
          style={{
            animation: motionOff
              ? 'none'
              : 'image-region-scan 1.2s linear infinite',
          }}
        />
      )}

      {!motionOff && (
        <style>{`
          @keyframes image-region-scan {
            0% { transform: translateX(0); }
            100% { transform: translateX(${vbW * 1.0}px); }
          }
        `}</style>
      )}
    </svg>
  )
}
