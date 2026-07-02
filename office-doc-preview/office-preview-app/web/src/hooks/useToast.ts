// 模型：claude-sonnet-4-6
// useToast — Toast 队列状态管理（zustand slice）
// Phase A.1: Translation UX Overhaul Agent 1
//
// API:
//   push({ kind, message, durationMs? })  → 加入队列，默认 4000ms 自动消失
//   dismiss(id)                            → 立即移除
//   clear()                                → 清空队列
//   queue: ToastItem[]                     → 当前队列
//
// Observability: push 时 console.info('[translate-toast ISO] kind=… message=… durationMs=…')

import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  kind: ToastKind
  message: string
  /** 自动消失时间（ms），默认 4000 */
  durationMs: number
}

export interface ToastPushInput {
  kind: ToastKind
  message: string
  /** 可选，默认 4000ms */
  durationMs?: number
}

interface ToastState {
  queue: ToastItem[]
  push: (input: ToastPushInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

const DEFAULT_DURATION_MS = 4000

// 单调递增 id 生成器（在同 tab 内单调；多 tab 不保证但够用）
let _toastSeq = 0
function nextToastId(): string {
  _toastSeq += 1
  return `t_${Date.now().toString(36)}_${_toastSeq}`
}

export const useToastStore = create<ToastState>((set, get) => ({
  queue: [],

  push(input) {
    const id = nextToastId()
    const durationMs = input.durationMs ?? DEFAULT_DURATION_MS
    const item: ToastItem = {
      id,
      kind: input.kind,
      message: input.message,
      durationMs,
    }
    set({ queue: [...get().queue, item] })

    // Observability: 控制台日志，便于追踪
    const ts = new Date().toISOString()
    // eslint-disable-next-line no-console
    console.info(
      `[translate-toast ${ts}] kind=${input.kind} message="${input.message}" durationMs=${durationMs}`
    )

    // 自动 dismiss
    if (durationMs > 0) {
      setTimeout(() => {
        get().dismiss(id)
      }, durationMs)
    }

    return id
  },

  dismiss(id) {
    set({ queue: get().queue.filter(t => t.id !== id) })
  },

  clear() {
    set({ queue: [] })
  },
}))