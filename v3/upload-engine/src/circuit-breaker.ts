// ============================================================
// 断路器（Circuit Breaker）
// 三态状态机：CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN
// 对标：Netflix Hystrix / Resilience4j
// 核心价值：避免服务端故障时持续重试，雪上加霜
// ============================================================

export class CircuitOpenError extends Error {
  constructor(public until: number) {
    super(`断路器已熔断，${Math.ceil((until - Date.now()) / 1000)}s 后恢复`)
    this.name = 'CircuitOpenError'
  }
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureCount = 0
  private successCount = 0
  private openUntil = 0
  private cooldownMs = 5000 // 初始冷却 5s

  // 配置
  private failureThreshold = 5  // 连续失败 5 次 → 熔断
  private successThreshold = 2 // 半开状态下成功 2 次 → 恢复
  private maxCooldownMs = 60000 // 最大冷却 60s

  private onStateChange?: (from: CircuitState, to: CircuitState) => void

  constructor(opts?: {
    failureThreshold?: number
    successThreshold?: number
    cooldownMs?: number
    maxCooldownMs?: number
    onStateChange?: (from: CircuitState, to: CircuitState) => void
  }) {
    if (opts) Object.assign(this, opts)
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.openUntil) {
        throw new CircuitOpenError(this.openUntil)
      }
      // 冷却时间到 → 进入半开试探
      this.transition('HALF_OPEN')
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      // 用户取消不计数为失败
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (err instanceof Error && err.message === 'Aborted') throw err
      this.onFailure()
      throw err
    }
  }

  private onSuccess(): void {
    this.failureCount = 0

    if (this.state === 'HALF_OPEN') {
      this.successCount++
      if (this.successCount >= this.successThreshold) {
        this.transition('CLOSED')
        this.cooldownMs = 5000 // 重置冷却时间
      }
    }
  }

  private onFailure(): void {
    this.failureCount++
    this.successCount = 0

    if (this.state === 'HALF_OPEN') {
      // 试探失败 → 重新熔断，冷却时间翻倍
      this.cooldownMs = Math.min(this.cooldownMs * 2, this.maxCooldownMs)
      this.openUntil = Date.now() + this.cooldownMs
      this.transition('OPEN')
    } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.openUntil = Date.now() + this.cooldownMs
      this.transition('OPEN')
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state
    this.state = to
    this.onStateChange?.(from, to)
  }

  getState(): CircuitState {
    return this.state
  }

  reset(): void {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.successCount = 0
    this.cooldownMs = 5000
  }
}