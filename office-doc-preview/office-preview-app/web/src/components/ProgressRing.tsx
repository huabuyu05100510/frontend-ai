// 模型：claude-sonnet-4-6
// ProgressRing — SVG progress ring with 0.6s ease-out animation.
// Respects <html data-motion="off"> — skips transition when set.

import { useEffect, useState } from 'react'

export interface ProgressRingProps {
  percent: number // 0..100
  size?: number   // default 56
  stroke?: number // default 4
  label?: string  // center text
  showPercent?: boolean // default true
  'aria-label'?: string
}

export function ProgressRing({
  percent,
  size = 56,
  stroke = 4,
  label,
  showPercent = true,
  ...rest
}: ProgressRingProps) {
  const [motionOff, setMotionOff] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    setMotionOff(document.documentElement.getAttribute('data-motion') === 'off')
  }, [])

  const clamped = Math.max(0, Math.min(100, percent))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const transition = motionOff ? 'none' : 'stroke-dashoffset 0.6s ease-out'

  return (
    <svg
      className="xf-progress-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={rest['aria-label']}
      data-testid="xf-progress-ring"
    >
      <circle
        className="xf-progress-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="xf-progress-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition }}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="xf-progress-ring-label"
        fontSize={size * 0.28}
        fill="currentColor"
      >
        {label ?? (showPercent ? `${Math.round(clamped)}%` : '')}
      </text>
    </svg>
  )
}
