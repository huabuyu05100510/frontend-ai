// 模型：claude-sonnet-4-6
// PageTransition — wrapper that fades+slides on route change, respects reduced-motion

import { ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export interface PageTransitionProps {
  children: ReactNode
  routeKey?: string
  className?: string
  reducedMotion?: boolean
  [key: `data-${string}`]: unknown
}

export function PageTransition({
  children,
  routeKey,
  className,
  reducedMotion,
  ...rest
}: PageTransitionProps) {
  const off = reducedMotion ?? (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'off')

  if (off) {
    return <div className={className} {...rest}>{children}</div>
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={routeKey ?? 'page'}
        className={className}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        {...rest}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

PageTransition.displayName = 'PageTransition'
