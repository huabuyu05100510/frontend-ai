// 模型：claude-sonnet-4-6
// Toast — 通知堆叠容器
// Phase A.1: Translation UX Overhaul Agent 1
//
// - props: { queue: ToastItem[]; onDismiss: (id) => void }
// - Esc 关闭所有可见 toast
// - hover 暂停 auto-dismiss（仅在 useToast 内部计时器；UI 层只暴露 paused 状态）
// - AnimatePresence enter/exit
// - 语义 token: --color-toast-{success,error,info,warning} + --color-toast-bg
// - data-testid: oa-toast-container / oa-toast-{id} / oa-toast-{id}-dismiss

import { useEffect, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ToastItem } from '../hooks/useToast'

export interface ToastProps {
  queue: ToastItem[]
  onDismiss: (id: string) => void
  /** 自定义 className 容器 */
  className?: string
  /** aria-live 区域模式（默认 polite） */
  ariaLive?: 'polite' | 'assertive'
}

function isMotionOff(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-motion') === 'off'
}

const ENTER = { opacity: 0, y: 16, scale: 0.96 }
const ANIMATE = { opacity: 1, y: 0, scale: 1 }
const EXIT = { opacity: 0, y: 8, scale: 0.98 }
const EASE = [0.4, 0, 0.2, 1] as const

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem
  onDismiss: (id: string) => void
}) {
  const [paused, setPaused] = useState(false)
  // 记录进入时间 + 累计暂停时间，用于粗略"剩余时长"显示（不实现实际倒计时）
  const mountedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    mountedAtRef.current = Date.now()
  }, [item.id])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onDismiss(item.id)
    }
  }

  return (
    <motion.div
      key={item.id}
      data-testid={`oa-toast-${item.id}`}
      role="alert"
      aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
      className={`oa-toast oa-toast-${item.kind}`}
      data-kind={item.kind}
      data-paused={paused ? 'true' : 'false'}
      initial={ENTER}
      animate={ANIMATE}
      exit={EXIT}
      transition={{ duration: 0.18, ease: EASE }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="oa-toast-icon" aria-hidden="true" data-testid={`oa-toast-icon-${item.id}`}>
        {iconFor(item.kind)}
      </span>
      <span className="oa-toast-message" data-testid={`oa-toast-message-${item.id}`}>
        {item.message}
      </span>
      <button
        type="button"
        className="oa-toast-dismiss"
        aria-label="关闭通知"
        data-testid={`oa-toast-${item.id}-dismiss`}
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </motion.div>
  )
}

function iconFor(kind: ToastItem['kind']): string {
  switch (kind) {
    case 'success': return '✓'
    case 'error':   return '✕'
    case 'warning': return '!'
    case 'info':
    default:        return 'i'
  }
}

export function Toast({ queue, onDismiss, className, ariaLive = 'polite' }: ToastProps) {
  const motionOff = isMotionOff()

  // Esc → dismiss 全部
  useEffect(() => {
    if (queue.length === 0) return
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // 倒序 dismiss，先创建的后消失
      for (const item of queue) {
        try { onDismiss(item.id) } catch { /* noop */ }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [queue, onDismiss])

  if (queue.length === 0) return null

  const container = (
    <div
      data-testid="oa-toast-container"
      data-motion-off={motionOff ? 'true' : 'false'}
      aria-live={ariaLive}
      aria-relevant="additions"
      className={`oa-toast-container ${className ?? ''}`}
    >
      <AnimatePresence initial={false}>
        {queue.map(item => (
          <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  )

  return container
}