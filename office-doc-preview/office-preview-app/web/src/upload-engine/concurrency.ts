// ============================================================
// Semaphore 并发控制器
// 分片上传并发数限制 + 批量文件并发数限制
// 为什么不用 Promise.all？无法动态限制并发数
// ============================================================

export class Semaphore {
  private capacity: number
  private active = 0
  private queue: Array<() => void> = []

  constructor(count: number) {
    this.capacity = Math.max(1, count)
  }

  async acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active++
      return
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
    this.drain()
  }

  /**
   * 运行时动态调整并发上限（供自适应并发控制使用）。
   * 扩容时立即放行排队任务；缩容只影响后续 acquire，不抢占运行中任务。
   */
  setCapacity(n: number): void {
    this.capacity = Math.max(1, Math.floor(n))
    this.drain()
  }

  private drain(): void {
    while (this.active < this.capacity && this.queue.length > 0) {
      const next = this.queue.shift()!
      this.active++
      next()
    }
  }

  /** 获许可 → 执行 fn → 释放许可 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

/** 标记为不可重试的错误（如 4xx 客户端错误） */
export class NonRetryableError extends Error {
  readonly noRetry = true
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

// ============================================================
// 指数退避重试
// 1s → 2s → 4s
// ============================================================
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      // 用户取消/暂停不重试
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (err instanceof Error && err.message === 'Aborted') throw err
      // 不可重试错误（如 4xx）立即抛出
      if (err && typeof err === 'object' && (err as any).noRetry) throw err
      if (attempt === maxRetries) throw err
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}