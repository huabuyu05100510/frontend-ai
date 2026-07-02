// 模型：claude-sonnet-4-6
// MotionProvider — wraps tree with MotionConfig honoring reduced-motion
// Reads <html data-motion="off"> from P0.D's hook; if "off", forces reducedMotion="always"

import { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'

export interface MotionProviderProps {
  children: ReactNode
}

function getReducedMotionPreference(): 'always' | 'never' | 'user' {
  if (typeof document === 'undefined') return 'user'
  const attr = document.documentElement.getAttribute('data-motion')
  return attr === 'off' ? 'always' : 'user'
}

export function MotionProvider({ children }: MotionProviderProps) {
  // Phase 1.B: wrap with MotionConfig. Respects <html data-motion>.
  // 'always' kills all motion; 'user' follows system prefers-reduced-motion
  return (
    <MotionConfig reducedMotion={getReducedMotionPreference()}>
      {children}
    </MotionConfig>
  )
}

MotionProvider.displayName = 'MotionProvider'
