// 模型：claude-sonnet-4-6
// Hover primitive — wrapper that animates child on hover, respects reduced-motion

import { ReactNode, MouseEventHandler } from 'react'
import { motion } from 'motion/react'

export interface HoverProps {
  children: ReactNode
  onHover?: () => void
  onUnhover?: () => void
  scale?: number
  duration?: number
  className?: string
  /** when true, suppress animation entirely (data-motion="off") */
  reducedMotion?: boolean
  [key: `data-${string}`]: unknown
}

export function Hover({
  children,
  onHover,
  onUnhover,
  scale = 1.02,
  duration = 0.2,
  className,
  reducedMotion,
  ...rest
}: HoverProps) {
  const off = reducedMotion ?? (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'off')
  const handleEnter: MouseEventHandler = () => onHover?.()
  const handleLeave: MouseEventHandler = () => onUnhover?.()

  return (
    <motion.div
      className={className}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      whileHover={off ? undefined : { scale }}
      transition={{ duration: off ? 0 : duration, ease: [0.4, 0, 0.2, 1] }}
      style={{ display: 'inline-block' }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

Hover.displayName = 'Hover'
