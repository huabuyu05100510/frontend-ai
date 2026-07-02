// ============================================================================
// idleScheduler — requestIdleCallback 包装
//   用于把文字层等"非首屏必要"工作延后到浏览器空闲时段，避免阻塞渲染。
//   - 自动检测 rIC 不可用（旧 Safari、部分 jsdom）→ fallback 到 setTimeout
//   - deadline.timeRemaining() = 0 且未超时 → 自动重排，不丢任务
//   - 返回 cancel() 函数；cancel 后即使 idle 触发也不执行（幂等）
//   - fn 抛错不影响 scheduler 自身
// ============================================================================

type RICImpl = (
  cb: (deadline: { timeRemaining: () => number; didTimeout: boolean }) => void,
  options?: { timeout?: number }
) => number

type CICImpl = (handle: number) => void

interface GlobalThis {
  requestIdleCallback?: RICImpl
  cancelIdleCallback?: CICImpl
}

export interface IdleSchedulerOptions {
  /** requestIdleCallback 的超时阈值；超时强制执行 */
  timeout?: number
}

export function scheduleIdleTask(
  fn: () => void,
  options: IdleSchedulerOptions = {}
): () => void {
  let cancelled = false
  let ricHandle: number | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const g = globalThis as unknown as GlobalThis
  const ric = g.requestIdleCallback
  const cic = g.cancelIdleCallback

  const tryRun = (deadline: { timeRemaining: () => number; didTimeout: boolean }) => {
    if (cancelled) return
    if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
      try {
        fn()
      } catch {
        /* swallow；不让 scheduler 自身崩 */
      }
    } else {
      // 时间不够：本帧跳过，下一帧再排
      schedule()
    }
  }

  const schedule = () => {
    if (cancelled) return
    if (typeof ric === 'function') {
      ricHandle = ric(tryRun, options)
    } else {
      // fallback：timeRemaining 返回一个大值让 tryRun 立即执行
      timeoutHandle = setTimeout(
        () => tryRun({ timeRemaining: () => 50, didTimeout: false }),
        0
      )
    }
  }

  schedule()

  return () => {
    cancelled = true
    if (ricHandle !== null) {
      if (typeof cic === 'function') {
        try { cic(ricHandle) } catch { /* swallow */ }
      }
      ricHandle = null
    }
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
  }
}

// ============================================================================
// schedulePrefetch — idle 期间的批量预取调度
//   把一组 target 在浏览器空闲时段串行（或窗口并发）执行 doFetch。
//   关键约束：
//     - 每个 target 通过 scheduleIdleTask 调度 → 不会抢占首屏渲染
//     - window 控制并发窗口（默认 3）
//     - shouldFetch(t)=false 的 target 直接跳过
//     - 单个 doFetch 抛错被吞，不影响后续
//     - cancel() 返回后未开始的 target 不再启动
// ============================================================================

export interface SchedulePrefetchOptions extends IdleSchedulerOptions {
  /** 最大并发窗口；默认 3 */
  window?: number
}

export function schedulePrefetch<T>(
  targets: T[],
  shouldFetch: (t: T) => boolean,
  doFetch: (t: T) => Promise<void>,
  options: SchedulePrefetchOptions = {}
): () => void {
  const windowSize = Math.max(1, Math.floor(options.window ?? 3))
  const candidates = targets.filter(shouldFetch)

  let cancelled = false
  let nextIdx = 0
  let inFlight = 0
  const cleanups: Array<() => void> = []

  const tryStart = () => {
    if (cancelled) return
    while (inFlight < windowSize && nextIdx < candidates.length) {
      const target = candidates[nextIdx++]
      inFlight++
      // 每个 target 通过 scheduleIdleTask 串行触发，
      // 保证 doFetch 不会在主线程繁忙时阻塞首屏渲染。
      const cancelTask = scheduleIdleTask(async () => {
        if (cancelled) return
        try {
          await doFetch(target)
        } catch {
          /* swallow；不让单个失败打断整批 */
        } finally {
          inFlight--
          // 递归拉下一个，保持窗口
          tryStart()
        }
      }, options)
      cleanups.push(cancelTask)
    }
  }

  // 用第一个 idle slot 启动第一批（不直接同步跑）
  const firstCancel = scheduleIdleTask(() => {
    if (cancelled) return
    tryStart()
  }, options)
  cleanups.push(firstCancel)

  return () => {
    cancelled = true
    for (const c of cleanups) {
      try { c() } catch { /* swallow */ }
    }
    cleanups.length = 0
  }
}
