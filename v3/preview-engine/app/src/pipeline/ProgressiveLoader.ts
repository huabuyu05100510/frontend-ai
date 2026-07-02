import type { ProgressiveStage } from '../kernel/types'

// ============================================================================
// ProgressiveLoader — 三段式渐进首屏状态机
//   idle → skeleton(<16ms) → lqip(<100ms「可见」) → hires(<400ms 无感替换)
//   核心：把「可见」与「高清」解耦，firstVisibleAt 记录用户「看到内容」的时刻。
// ============================================================================

export interface ProgressiveSnapshot {
  stage: ProgressiveStage
  lqip: string | null
  hires: string | null
  firstVisibleAt: number | null
}

export interface ProgressiveOptions {
  /** 骨架/布局占位（文档指纹），可选 */
  loadSkeleton?: () => Promise<void>
  /** 预渲染低清封面（LQIP），未预渲染时省略 */
  loadLQIP?: () => Promise<string>
  /** 客户端高清渲染 */
  loadHiRes: () => Promise<string>
  /** 时钟注入（测试用） */
  now?: () => number
}

type Listener = (snap: ProgressiveSnapshot) => void

export class ProgressiveLoader {
  stage: ProgressiveStage = 'idle'
  lqip: string | null = null
  hires: string | null = null
  firstVisibleAt: number | null = null

  private opts: ProgressiveOptions
  private now: () => number
  private listeners: Listener[] = []
  private cancelled = false
  private startPromise: Promise<void> | null = null

  constructor(opts: ProgressiveOptions) {
    this.opts = opts
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  private setStage(stage: ProgressiveStage): void {
    this.stage = stage
    const snap: ProgressiveSnapshot = {
      stage,
      lqip: this.lqip,
      hires: this.hires,
      firstVisibleAt: this.firstVisibleAt,
    }
    for (const l of this.listeners) l(snap)
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.run()
    return this.startPromise
  }

  cancel(): void {
    this.cancelled = true
  }

  private async run(): Promise<void> {
    // ① 骨架
    this.setStage('skeleton')
    await (this.opts.loadSkeleton?.() ?? Promise.resolve())
    if (this.cancelled) return

    // ② 低清「可见」
    if (this.opts.loadLQIP) {
      this.setStage('lqip')
      try {
        const v = await this.opts.loadLQIP()
        if (this.cancelled) return
        this.lqip = v
        this.firstVisibleAt = this.now()
      } catch {
        // LQIP 失败非致命，继续走高清
      }
      if (this.cancelled) return
    }

    // ③ 高清无感替换
    this.setStage('hires-loading')
    try {
      const v = await this.opts.loadHiRes()
      if (this.cancelled) return
      this.hires = v
      if (this.firstVisibleAt === null) this.firstVisibleAt = this.now()
      this.setStage('hires-ready')
    } catch {
      if (this.cancelled) return
      this.setStage('error') // 高清失败，保留 LQIP 兜底可见
    }
  }
}
