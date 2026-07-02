/**
 * @skeleton/adapter-rn - InteractionManager 调度器
 *
 * React Native 的 InteractionManager.runAfterInteractions：
 * - 等待所有动画/交互完成后执行
 * - 不阻塞手势响应和动画帧
 * - 适合在进入页面后（路由动画结束）自动触发骨架捕获
 */

import type { Scheduler } from '@skeleton/core'

// 声明 InteractionManager 类型（避免直接 import react-native）
interface InteractionManagerType {
  runAfterInteractions: (cb: () => void) => { cancel: () => void }
}

declare const InteractionManager: InteractionManagerType | undefined

const BATCH_SIZE = 50

/**
 * 基于 InteractionManager 的 RN 调度器。
 *
 * 降级策略：
 * - 有 InteractionManager → 等待交互/动画结束后分批执行
 * - 无（测试环境/Web）→ 降级为 setTimeout(0) + 固定批次
 */
export function createInteractionScheduler(): Scheduler {
  let cancelled = false
  let handle: { cancel: () => void } | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return {
    schedule(work: (batchSize: number) => boolean) {
      cancelled = false

      const hasIM = typeof InteractionManager !== 'undefined'

      if (hasIM) {
        handle = InteractionManager!.runAfterInteractions(() => {
          if (cancelled) return
          // 分批执行（模拟 rIC 效果）
          const runBatch = () => {
            if (cancelled) return
            const hasMore = work(BATCH_SIZE)
            if (hasMore) {
              handle = InteractionManager!.runAfterInteractions(runBatch)
            }
          }
          runBatch()
        })
      } else {
        // 降级
        const runBatch = () => {
          if (cancelled) return
          const hasMore = work(BATCH_SIZE)
          if (hasMore) {
            timeoutId = setTimeout(runBatch, 0)
          }
        }
        timeoutId = setTimeout(runBatch, 0)
      }
    },

    cancel() {
      cancelled = true
      handle?.cancel()
      handle = null
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
  }
}
