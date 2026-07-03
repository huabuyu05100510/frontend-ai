/**
 * Scheduler —— 协作式调度器，替换 requestIdleCallback
 *
 * 三条降级链路（构造时一次性探测）：
 *   1. 原生 requestIdleCallback（Chrome / 较新 Firefox）
 *   2. requestAnimationFrame + MessageChannel（iOS Safari / 老 Firefox / WebView）
 *      rAF 标帧起点 → port.postMessage 让出主线程 → 收到消息跑 batch，
 *      用 performance.now() 检查 5ms 预算，超了就再 rAF 一次
 *   3. setTimeout(0) + 预算检查（极老环境兜底）
 *
 * 行为约定：
 *   - 单 slice 默认预算 5ms（@60fps 留 ~11ms 给浏览器渲染/输入）
 *   - 任务排队超过 timeout（默认 2000ms）→ didTimeout=true，强制跑
 *   - 任务抛错 swallow，不影响其他任务
 *   - schedule 返回 cancel fn，调用后任务从队列移除（若已 shift 出队则无副作用）
 */

export interface TaskDeadline {
  /** 当前 slice 剩余预算（ms） */
  timeRemaining(): number
  /** 任务排队超过 timeout，应强制执行（无视预算） */
  didTimeout: boolean
}

export type Task = (deadline: TaskDeadline) => void

export interface ScheduleOpts {
  /** 任务最长可排队时间（ms），超过后强制执行。默认 2000 */
  timeout?: number
}

interface QueueItem {
  task: Task
  insertedAt: number
  timeout: number
}

const SLICE_BUDGET_MS = 5

type Strategy = 'ric' | 'rAF' | 'setTimeout'

export class Scheduler {
  private queue: QueueItem[] = []
  private scheduled = false
  private readonly strategy: Strategy
  private readonly channel?: MessageChannel
  private readonly ric?: typeof requestIdleCallback

  constructor() {
    const g = globalThis as {
      requestIdleCallback?: typeof requestIdleCallback
      requestAnimationFrame?: typeof requestAnimationFrame
      MessageChannel?: typeof MessageChannel
    }
    if (typeof g.requestIdleCallback === 'function') {
      this.strategy = 'ric'
      // 坑：原生 ric 是 window 方法，存为实例字段后调用会丢 this → Illegal invocation
      // 包一层 bind 把 this 钉到 globalThis
      this.ric = g.requestIdleCallback.bind(g)
    } else if (typeof g.MessageChannel === 'function' && typeof g.requestAnimationFrame === 'function') {
      this.strategy = 'rAF'
      this.channel = new g.MessageChannel()
      this.channel.port1.onmessage = () => this.flush()
    } else {
      this.strategy = 'setTimeout'
    }
  }

  schedule(task: Task, opts?: ScheduleOpts): () => void {
    const item: QueueItem = {
      task,
      insertedAt: now(),
      timeout: opts?.timeout ?? 2000,
    }
    this.queue.push(item)
    this.kick()
    return () => {
      const i = this.queue.indexOf(item)
      if (i >= 0) this.queue.splice(i, 1)
    }
  }

  /** 仅测试用：当前队列长度 */
  _pending(): number {
    return this.queue.length
  }

  private kick(): void {
    if (this.scheduled) return
    this.scheduled = true
    if (this.strategy === 'ric' && this.ric) {
      // 原生 ric：把 flush 作为 idle callback，ric 自己负责调度时机 + 预算
      this.ric(
        (deadline) => this.flush(deadline),
        { timeout: 2000 },
      )
    } else if (this.strategy === 'rAF') {
      // rAF 标帧起点，再通过 MessageChannel port.postMessage 让出主线程（macrotask，比 setTimeout(0) 快且不受 4ms clamp）
      globalThis.requestAnimationFrame!((() => {
        this.channel!.port2.postMessage(null)
      }) as FrameRequestCallback)
    } else {
      // 极老环境兜底
      setTimeout(() => this.flush(), 0)
    }
  }

  private flush(ricDeadline?: IdleDeadline): void {
    this.scheduled = false
    const sliceStart = now()

    while (this.queue.length > 0) {
      const item = this.queue[0]
      const elapsedSinceInsert = now() - item.insertedAt
      const didTimeout = elapsedSinceInsert > item.timeout

      const remaining = ricDeadline
        ? ricDeadline.timeRemaining()
        : Math.max(0, SLICE_BUDGET_MS - (now() - sliceStart))

      // 没超时 + 预算耗尽 → 让出，等下次调度
      if (!didTimeout && remaining <= 0) {
        this.kick()
        return
      }

      // 出队执行（先 shift 再跑，避免 cancel 时找不到）
      this.queue.shift()
      const deadline: TaskDeadline = {
        timeRemaining: () => Math.max(0, ricDeadline ? ricDeadline.timeRemaining() : SLICE_BUDGET_MS),
        didTimeout,
      }
      try {
        item.task(deadline)
      } catch {
        /* 单任务抛错不影响其他任务 */
      }
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}
