// 模型：claude-sonnet-4-6
// Press primitive — wrapper that animates child on press, respects reduced-motion

import { ReactNode } from 'react'
import { motion } from 'motion/react'

export interface PressProps {
  children: ReactNode
  onPressStart?: () => void
  onPressEnd?: () => void
  scale?: number
  duration?: number
  className?: string
  reducedMotion?: boolean
  [key: `data-${string}`]: unknown
}

export function Press({
  children,
  onPressStart,
  onPressEnd,
  scale = 0.97,
  duration = 0.08,
  className,
  reducedMotion,
  ...rest
}: PressProps) {
  const off = reducedMotion ?? (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'off')

  return (
    <motion.div
      className={className}
      onPointerDown={() => onPressStart?.()}
      onPointerUp={() => onPressEnd?.()}
      whileTap={off ? undefined : { scale }}
      transition={{ duration: off ? 0 : duration, ease: [0.4, 0, 0.2, 1] }}
      style={{ display: 'inline-block' }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

Press.displayName = 'Press'
