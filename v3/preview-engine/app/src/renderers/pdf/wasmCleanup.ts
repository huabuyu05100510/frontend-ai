// ============================================================================
// WasmCleanupScheduler — 周期性调度 pdf.js WASM heap 清理
//   pdf.js 的 worker 会在内部 cache 解码后的字体、图像、CMap 等，
//   长时间运行后 heap 累积。`pdfjsLib.cleanup()` 会主动释放这些资源。
//
//   本模块的策略：
//     - 每次 PdfPage 渲染成功调 `recordRender()` 累加计数
//     - 计数达到 `threshold`（默认 10）时通过 scheduleIdleTask 调 cleanup
//     - cleanup 是同步 / async 都兼容，错误一律吞掉
//     - cleanup 完成后（无论成功失败）计数清零，重新累积
//     - 组件 unmount 调 `cancel()` 阻止任何 pending cleanup
// ============================================================================

import { scheduleIdleTask, type IdleSchedulerOptions } from './idleScheduler'

export interface CleanupSchedulerOptions {
  /** cleanup 之间的最小间隔（毫秒），用于避免 cleanup 被反复触发 */
  intervalMs?: number
  /** 触发 cleanup 所需的累积 render 次数 */
  threshold?: number
  /** 注入的清理逻辑；典型实现：`() => pdfjsLib.cleanup?.()` */
  cleanup?: () => Promise<void> | void
  /** 用于测试：注入当前时间 */
  now?: () => number
  /** 透传给 scheduleIdleTask 的 options */
  idleOptions?: IdleSchedulerOptions
}

const DEFAULTS = {
  intervalMs: 30_000,
  threshold: 10,
} as const

export class WasmCleanupScheduler {
  private readonly intervalMs: number
  private readonly threshold: number
  private readonly cleanup: () => Promise<void> | void
  private readonly now: () => number
  private readonly idleOptions: IdleSchedulerOptions | undefined

  private count = 0
  private lastCleanupAt = 0
  private cancelled = false
  private pendingCancel: (() => void) | null = null
  private running = false

  constructor(opts: CleanupSchedulerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? DEFAULTS.intervalMs
    this.threshold = opts.threshold ?? DEFAULTS.threshold
    this.cleanup = opts.cleanup ?? (() => { /* default noop */ })
    this.now = opts.now ?? (() => Date.now())
    this.idleOptions = opts.idleOptions
  }

  /** 每次 render 成功调用 */
  recordRender(): void {
    if (this.cancelled) return
    this.count++
    if (this.count >= this.threshold) {
      this.maybeScheduleCleanup()
    }
  }

  /** 主动取消；未开始的 cleanup 不再执行 */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    if (this.pendingCancel) {
      try { this.pendingCancel() } catch { /* swallow */ }
      this.pendingCancel = null
    }
  }

  private maybeScheduleCleanup(): void {
    if (this.cancelled || this.running) return
    const elapsed = this.now() - this.lastCleanupAt
    if (this.lastCleanupAt > 0 && elapsed < this.intervalMs) {
      // 距上次 cleanup 还没到间隔 → 等下一个 recordRender 再看
      return
    }
    this.running = true
    const fn = this.cleanup
    this.pendingCancel = scheduleIdleTask(() => {
      this.pendingCancel = null
      // 捕获所有错误，cleanup 失败不破坏 scheduler
      let result: Promise<void> | void
      try {
        result = fn()
      } catch {
        this.afterCleanup()
        return
      }
      if (result && typeof (result as Promise<void>).then === 'function') {
        ;(result as Promise<void>)
          .catch(() => { /* swallow rejected cleanup */ })
          .finally(() => this.afterCleanup())
      } else {
        this.afterCleanup()
      }
    }, this.idleOptions)
  }

  private afterCleanup(): void {
    this.running = false
    this.count = 0
    this.lastCleanupAt = this.now()
  }
}