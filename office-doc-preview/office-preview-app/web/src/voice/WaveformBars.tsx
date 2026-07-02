// WaveformBars — 实时音量波形条（对标 Otter.ai / iOS Voice Memo）
// 模型：claude-sonnet-4-6
// 颜色迁移至 semantic.ts (Phase 2.A)
import React from 'react'

export interface WaveformBarsProps {
  levels: number[]
  active: boolean
  height?: number
  barWidth?: number
  gap?: number
  color?: string
}

export const WaveformBars: React.FC<WaveformBarsProps> = ({
  levels, active, height = 80, barWidth = 4, gap = 3, color = 'var(--color-primary)',
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        height,
        width: '100%',
        perspective: 200,
      }}
      aria-hidden
    >
      {levels.map((lv, i) => {
        const h = Math.max(barWidth, lv * height)
        const isCenter = Math.abs(i - levels.length / 2) < 2
        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height: h,
              background: color,
              borderRadius: barWidth / 2,
              opacity: active ? (isCenter ? 1 : 0.4 + lv * 0.6) : 0.2,
              transform: `scaleY(${active ? 1 : 0.3})`,
              transition: 'height 0.08s linear, opacity 0.18s',
              boxShadow: active && lv > 0.6 ? `0 0 ${barWidth * 2}px ${color}66` : 'none',
            }}
          />
        )
      })}
    </div>
  )
}
WaveformBars.displayName = 'WaveformBars'
