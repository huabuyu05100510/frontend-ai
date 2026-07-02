// 模型：claude-sonnet-4-6
// Motion barrel — re-exports from `motion` package + primitives
// Phase 1.B: also re-exports motion primitives (Hover, Press, PageTransition)

export { motion, AnimatePresence, LayoutGroup } from 'motion/react'
export { MotionConfig } from 'motion/react'
export type { Variants, Transition } from 'motion/react'

export { Hover, Press, PageTransition } from './primitives'
