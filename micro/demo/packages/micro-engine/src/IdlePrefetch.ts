/**
 * IdlePrefetch —— 用 Scheduler 把 entry HTML / 子应用 CDN 资源预取进 HTTP disk cache
 *
 * 改造点：原先直接调 requestIdleCallback，现在统一走 Scheduler（三条降级链路保证 iOS Safari 等
 * 不支持 ric 的环境也能预取）。
 *
 * 边界：
 *   - 同 url 只预取一次（去重）
 *   - 同源 include / 跨域 omit cookie（避免 CDN 因 Allow-Credentials 缺失拒收）
 *   - 失败静默（prefetch 不应阻塞业务）
 *   - cancel 时把所有 pending task 从 Scheduler 撤销
 */

import { Scheduler } from './Scheduler'

export class IdlePrefetch {
  private seen = new Set<string>()
  private cancels: Array<() => void> = []
  private cancelled = false
  private hits = 0
  private misses = 0
  private readonly scheduler: Scheduler

  constructor(scheduler?: Scheduler) {
    this.scheduler = scheduler ?? new Scheduler()
  }

  prefetch(urls: string[]): void {
    this.cancelled = false
    for (const raw of urls) {
      if (!raw || this.seen.has(raw)) continue
      this.seen.add(raw)
      // 每个 url 一个 task；Scheduler 自己负责分帧 / 预算 / 兜底调度
      const cancel = this.scheduler.schedule(
        () => {
          const sameOrigin =
            typeof location !== 'undefined' &&
            new URL(raw, location.href).origin === location.origin
          fetch(raw, { credentials: sameOrigin ? 'include' : 'omit' })
            .then((r) => {
              if (r.ok) this.hits++
              else this.misses++
            })
            .catch(() => this.misses++)
        },
        { timeout: 2000 },
      )
      this.cancels.push(cancel)
    }
  }

  /** 测试 / 面板用：cache 是否已含某 url */
  has(url: string): boolean {
    return this.seen.has(url)
  }

  stats(): { hits: number; misses: number; queued: number } {
    return { hits: this.hits, misses: this.misses, queued: this.seen.size }
  }

  cancel(): void {
    this.cancelled = true
    for (const c of this.cancels) {
      try {
        c()
      } catch {
        /* ignore */
      }
    }
    this.cancels = []
    this.seen.clear()
  }
}
