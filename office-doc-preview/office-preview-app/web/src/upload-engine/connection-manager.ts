// ============================================================
// 自适应并发控制
// 基于 Network Information API + EWMA 延迟采样
// 对标：Chrome 同域名 6 连接上限动态分配
// ============================================================

export class ConnectionManager {
  maxConcurrent: number
  private minConcurrent = 1
  private absoluteMax = 5 // 低于 Chrome 6 连接上限，留 1 给其他请求

  // EWMA 平滑
  private ewmaLatency = 0
  private ewmaAlpha = 0.3

  // 滑动窗口成功率
  private successWindow: boolean[] = []
  private windowSize = 20

  private changeHandlers = new Set<(from: number, to: number) => void>()

  private notifyChange(from: number, to: number): void {
    this.changeHandlers.forEach(fn => fn(from, to))
  }

  constructor() {
    this.maxConcurrent = this.getInitialConcurrency()
    this.listenNetworkChange()
  }

  private getInitialConcurrency(): number {
    const conn = (navigator as any).connection
    if (!conn) return 3
    const map: Record<string, number> = {
      'slow-2g': 1, '2g': 1, '3g': 2, '4g': 4, '5g': 5,
    }
    return map[conn.effectiveType] ?? 3
  }

  private listenNetworkChange(): void {
    const conn = (navigator as any).connection
    if (!conn) return
    conn.addEventListener('change', () => {
      const map: Record<string, number> = {
        'slow-2g': 1, '2g': 1, '3g': 2, '4g': 4, '5g': 5,
      }
      const newConcurrency = map[conn.effectiveType] ?? 3
      if (newConcurrency !== this.maxConcurrent) {
        const old = this.maxConcurrent
        this.maxConcurrent = newConcurrency
        this.notifyChange(old, newConcurrency)
      }
    })
  }

  /** 记录分片完成，用于运行时自适应调整 */
  recordChunk(latencyMs: number, success: boolean): void {
    // EWMA 延迟平滑
    if (this.ewmaLatency === 0) {
      this.ewmaLatency = latencyMs
    } else {
      this.ewmaLatency = this.ewmaAlpha * latencyMs + (1 - this.ewmaAlpha) * this.ewmaLatency
    }

    // 滑动窗口成功率
    this.successWindow.push(success)
    if (this.successWindow.length > this.windowSize) {
      this.successWindow.shift()
    }

    this.adapt()
  }

  private adapt(): void {
    if (this.successWindow.length < 10) return

    const successRate = this.successWindow.filter(Boolean).length / this.successWindow.length

    // 成功率 < 80% → 降低并发
    if (successRate < 0.8) {
      const newVal = Math.max(this.minConcurrent, this.maxConcurrent - 1)
      if (newVal !== this.maxConcurrent) {
        const old = this.maxConcurrent
        this.maxConcurrent = newVal
        this.notifyChange(old, newVal)
      }
      return
    }

    // 成功率 > 98% 且 EWMA 延迟 < 1s → 增加并发
    if (successRate > 0.98 && this.ewmaLatency < 1000) {
      const newVal = Math.min(this.absoluteMax, this.maxConcurrent + 1)
      if (newVal !== this.maxConcurrent) {
        const old = this.maxConcurrent
        this.maxConcurrent = newVal
        this.notifyChange(old, newVal)
      }
    }
  }

  getEWMALatency(): number {
    return Math.round(this.ewmaLatency)
  }

  getSuccessRate(): number {
    if (this.successWindow.length === 0) return 1
    return this.successWindow.filter(Boolean).length / this.successWindow.length
  }

  /** 订阅并发变化，返回取消订阅函数 */
  onChange(fn: (from: number, to: number) => void): () => void {
    this.changeHandlers.add(fn)
    return () => this.changeHandlers.delete(fn)
  }
}