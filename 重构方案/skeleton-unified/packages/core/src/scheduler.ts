/**
 * @skeleton/core - 调度器（Scheduler）
 *
 * 骨架捕获是 CPU 密集型任务（需遍历大量 DOM/View 节点）。
 * 在主线程同步执行会阻塞渲染，导致明显卡顿。
 *
 * 各平台分片机制：
 * - Web：requestIdleCallback（浏览器空闲帧，最优），降级到 setTimeout(0)
 * - React Native：InteractionManager.runAfterInteractions（动画结束后执行）
 * - 微信小程序：wx.nextTick + 固定批次分片（每次 50 个节点）
 * - 构建期/Node.js：同步执行（无 UI，无需分片）
 *
 * 统一接口：
 * ```ts
 * const scheduler = createRICScheduler()  // Web
 * scheduler.schedule((batchSize) => {
 *   // 处理 batchSize 个节点
 *   // 返回 true = 本批完成，还有更多工作
 *   // 返回 false = 所有工作完成
 *   return hasMoreWork
 * })
 * ```
 *
 * ChunkedWalker：通用 BFS 分片遍历器，驱动 NodeMeasurement 树的异步遍历。
 */

import type { NodeMeasurement, Scheduler } from './types.js'

// ─── Web：requestIdleCallback 调度器 ─────────────────────────────────────────

/**
 * 基于 requestIdleCallback 的调度器（Web 专用）。
 * 利用浏览器空闲帧执行工作，不阻塞动画和交互。
 *
 * 降级策略：
 * - 支持 rIC → 使用 rIC（帧预算动态分配）
 * - 不支持 rIC（Safari<16/Node）→ 降级为 setTimeout(0) + 固定批次
 *
 * @param batchSizeFallback  降级模式下每次处理节点数，默认 50
 * @param timeoutMs          rIC 的 timeout，超时后强制执行，默认 1000ms
 */
export function createRICScheduler(
  batchSizeFallback = 50,
  timeoutMs = 1000,
): Scheduler {
  let cancelled = false
  let rafId: number | null = null

  return {
    schedule(work: (batchSize: number) => boolean) {
      cancelled = false

      const hasRIC = typeof requestIdleCallback !== 'undefined'

      if (hasRIC) {
        const run = (deadline: IdleDeadline) => {
          if (cancelled) return

          // 动态批次：根据剩余时间估算可处理节点数（约 0.1ms/节点）
          const remaining = deadline.timeRemaining()
          const batchSize = Math.max(1, Math.floor(remaining / 0.1))

          const hasMore = work(batchSize)
          if (hasMore) {
            rafId = requestIdleCallback(run, { timeout: timeoutMs })
          }
        }
        rafId = requestIdleCallback(run, { timeout: timeoutMs })
      } else {
        // 降级：setTimeout(0)，固定批次
        const run = () => {
          if (cancelled) return
          const hasMore = work(batchSizeFallback)
          if (hasMore) {
            rafId = setTimeout(run, 0) as unknown as number
          }
        }
        rafId = setTimeout(run, 0) as unknown as number
      }
    },

    cancel() {
      cancelled = true
      if (rafId !== null) {
        if (typeof cancelIdleCallback !== 'undefined') {
          cancelIdleCallback(rafId)
        } else {
          clearTimeout(rafId)
        }
        rafId = null
      }
    },
  }
}

// ─── 同步调度器（构建期/Node.js）─────────────────────────────────────────────

/**
 * 同步调度器（构建期 / Node.js / 测试环境）。
 * 直接调用工作函数直到完成，无分片。
 */
export function createSyncScheduler(): Scheduler {
  return {
    schedule(work: (batchSize: number) => boolean) {
      while (work(Infinity)) {
        // 继续直到完成
      }
    },
    cancel() {
      // 同步调度无法取消，noop
    },
  }
}

// ─── 微信小程序调度器 ──────────────────────────────────────────────────────────

/**
 * 微信小程序调度器（基于 wx.nextTick + 固定批次）。
 * 小程序无 requestIdleCallback，用 nextTick 模拟帧间隙。
 *
 * @param batchSize 每次处理节点数，默认 50
 */
export function createWxNextTickScheduler(batchSize = 50): Scheduler {
  let cancelled = false

  return {
    schedule(work: (batchSize: number) => boolean) {
      cancelled = false

      const run = () => {
        if (cancelled) return
        const hasMore = work(batchSize)
        if (hasMore) {
          // wx.nextTick 在下一帧执行
          if (typeof wx !== 'undefined' && wx.nextTick) {
            wx.nextTick(run)
          } else {
            setTimeout(run, 0)
          }
        }
      }

      if (typeof wx !== 'undefined' && wx.nextTick) {
        wx.nextTick(run)
      } else {
        setTimeout(run, 0)
      }
    },

    cancel() {
      cancelled = true
    },
  }
}

// 声明 wx 全局类型（避免 TS 报错，不引入 miniprogram 类型包）
declare const wx: {
  nextTick: (cb: () => void) => void
} | undefined

// ─── ChunkedWalker：通用分片 BFS 遍历器 ───────────────────────────────────────

/**
 * 通用分片 BFS 遍历器，使用调度器驱动异步 BFS 遍历 NodeMeasurement 树。
 *
 * 使用方式：
 * ```ts
 * const walker = new ChunkedWalker(createRICScheduler())
 * walker.walk(rootNode, processNode, () => {
 *   console.log('done')
 * })
 * ```
 *
 * 每帧处理 batchSize 个节点，处理完当前节点后将子节点入队。
 * 适用于运行时捕获场景（不阻塞主线程）。
 */
export class ChunkedWalker<T> {
  private queue: NodeMeasurement[] = []
  private results: T[] = []
  private scheduler: Scheduler
  private running = false

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler
  }

  /**
   * 开始分片遍历。
   *
   * @param root        根节点（从其子节点开始遍历）
   * @param processNode 节点处理函数，返回 T[] 追加到结果
   * @param onDone      遍历完成回调
   */
  walk(
    root: NodeMeasurement,
    processNode: (node: NodeMeasurement) => T[],
    onDone: (results: T[]) => void,
  ): void {
    if (this.running) this.cancel()

    this.queue = [...root.children]
    this.results = []
    this.running = true

    this.scheduler.schedule((batchSize) => {
      const limit = isFinite(batchSize) ? batchSize : this.queue.length

      let processed = 0
      while (processed < limit && this.queue.length > 0) {
        const node = this.queue.shift()!
        const items = processNode(node)
        this.results.push(...items)
        // 将子节点加入 BFS 队列
        this.queue.push(...node.children)
        processed++
      }

      if (this.queue.length === 0) {
        this.running = false
        onDone(this.results)
        return false // 完成
      }
      return true // 还有更多
    })
  }

  cancel(): void {
    this.scheduler.cancel()
    this.queue = []
    this.results = []
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }
}

// ─── 工具：Promise 化的遍历 ────────────────────────────────────────────────────

/**
 * Promise 化的分片遍历（适合 async/await 场景）。
 *
 * @example
 * const bones = await walkAsync(rootNode, processNode, createRICScheduler())
 */
export function walkAsync<T>(
  root: NodeMeasurement,
  processNode: (node: NodeMeasurement) => T[],
  scheduler: Scheduler,
): Promise<T[]> {
  return new Promise((resolve) => {
    const walker = new ChunkedWalker<T>(scheduler)
    walker.walk(root, processNode, resolve)
  })
}
