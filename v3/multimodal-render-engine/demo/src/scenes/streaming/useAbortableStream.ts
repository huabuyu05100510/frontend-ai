/**
 * useAbortableStream — 竞态防护核心逻辑
 *
 * 每次调用 start()：
 *   1. 中止上一次 AbortController
 *   2. 创建新 AbortController
 *   3. 递增 version 号
 *
 * 回调中通过 isCurrentVersion(v) 校验，旧版本响应静默丢弃。
 *
 * 对应简历：
 *   "每次路线变化递增版本号，SSE 回调先校验版本号，
 *    旧版本响应直接丢弃"
 */

export interface AbortableStream {
  /** 开始新一轮请求，返回新的 AbortController */
  start(): AbortController
  /** 强制中止当前请求 */
  abort(): void
  /** 当前版本号 */
  readonly currentVersion: number
  /** 判断给定版本是否仍为当前版本 */
  isCurrentVersion(version: number): boolean
}

export function createAbortableStream(): AbortableStream {
  let version = 0
  let currentController: AbortController | null = null

  return {
    start(): AbortController {
      // 中止上一次
      currentController?.abort()
      // 创建新的
      currentController = new AbortController()
      version++
      return currentController
    },

    abort(): void {
      currentController?.abort()
    },

    get currentVersion(): number {
      return version
    },

    isCurrentVersion(v: number): boolean {
      return v === version
    },
  }
}

// ── React hook 封装（供组件使用）────────────────────────────

import { useRef, useCallback } from 'react'

export function useAbortableStream() {
  const streamRef = useRef(createAbortableStream())

  const start = useCallback(() => {
    return streamRef.current.start()
  }, [])

  const abort = useCallback(() => {
    streamRef.current.abort()
  }, [])

  const isCurrentVersion = useCallback((v: number) => {
    return streamRef.current.isCurrentVersion(v)
  }, [])

  const getCurrentVersion = useCallback(() => {
    return streamRef.current.currentVersion
  }, [])

  return { start, abort, isCurrentVersion, getCurrentVersion }
}
