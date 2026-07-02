/**
 * PerfCollector — 性能数据采集器
 *
 * 职责：
 * - rAF loop 计算 FPS（1s 滑动窗口）
 * - 接收外部上报的 renderTime / hitTestTime
 * - 每 500ms 批量通知订阅者（避免高频 re-render）
 */

export interface PerfSnapshot {
  fps: number             // 1s 滑动窗口帧率
  renderTime: number      // ms，最近一次 annotation render 耗时
  hitTestTime: number     // ms，最近一次 R-Tree hitTest 耗时
  annotationCount: number
  poolSize: number        // VirtualPagePool 当前 canvas 页数
  poolMax: number         // maxPoolSize 配置值
}

export class PerfCollector {
  private snapshot: PerfSnapshot = {
    fps: 0,
    renderTime: 0,
    hitTestTime: 0,
    annotationCount: 0,
    poolSize: 0,
    poolMax: 5,
  }

  private listeners = new Set<(s: PerfSnapshot) => void>()
  private rafHandle = 0
  private intervalHandle = 0
  private frameTimestamps: number[] = []

  constructor() {
    // 通知 interval 始终开启，stop() 时停止
    this.intervalHandle = window.setInterval(() => {
      this.notify()
    }, 500)
  }

  // ── rAF FPS loop ──────────────────────────────────────────────────────────

  /** 启动 rAF FPS 采集循环（调用后才有 fps 数据） */
  start(): void {
    if (this.rafHandle) return
    this.rafHandle = requestAnimationFrame(this.tick)
  }

  stop(): void {
    cancelAnimationFrame(this.rafHandle)
    clearInterval(this.intervalHandle)
    this.rafHandle = 0
    this.intervalHandle = 0
  }

  private tick = (now: number) => {
    this.frameTimestamps.push(now)
    const cutoff = now - 1000
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift()
    }
    this.snapshot.fps = this.frameTimestamps.length
    this.rafHandle = requestAnimationFrame(this.tick)
  }

  // ── 外部上报接口 ──────────────────────────────────────────────────────────

  recordRender(ms: number): void {
    this.snapshot.renderTime = ms
  }

  recordHitTest(ms: number): void {
    this.snapshot.hitTestTime = ms
  }

  setAnnotationCount(n: number): void {
    this.snapshot.annotationCount = n
  }

  setPoolStatus(size: number, max: number): void {
    this.snapshot.poolSize = size
    this.snapshot.poolMax = max
  }

  // ── 订阅 ────────────────────────────────────────────────────────────────

  subscribe(fn: (s: PerfSnapshot) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot(): PerfSnapshot {
    return { ...this.snapshot }
  }

  private notify(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.getSnapshot()
    this.listeners.forEach(fn => fn(snapshot))
  }
}
