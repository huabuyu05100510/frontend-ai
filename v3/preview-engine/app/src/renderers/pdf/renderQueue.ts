// ============================================================================
// RenderQueue — PDF 渲染任务并发队列（按优先级排序 + pageNum 去重）
//   替代 PdfViewer.tsx 里模块级的 renderQueue 状态，便于：
//   1) 单测（纯逻辑，无 React 副作用）
//   2) 优先级从 "页码越小越靠前" 改为 "距离当前视口越近越靠前"
//   3) 任意组件 unmount 时调 queue.cancel() 而无需全局变量
// ============================================================================

export interface RenderTask {
  pageNum: number
  /** 数值越小越优先（先跑）。建议用 |pageNum - currentPage| */
  priority: number
  start: () => Promise<void>
  cancel: () => void
}

export class RenderQueue {
  private queue: RenderTask[] = []
  private activeCount = 0
  private drainedResolvers: Array<() => void> = []

  constructor(public readonly maxConcurrent: number) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error(`RenderQueue maxConcurrent must be > 0 (got ${maxConcurrent})`)
    }
  }

  /**
   * 入队。同 pageNum 已存在则 cancel 旧的并替换。
   * priority 升序插入（小优先 = 高优先级），保证视口附近的页先渲染。
   */
  enqueue(task: RenderTask): void {
    // 1) 去重：pending 中同 pageNum 取消
    const dupIdx = this.queue.findIndex(q => q.pageNum === task.pageNum)
    if (dupIdx >= 0) {
      this.queue[dupIdx].cancel()
      this.queue.splice(dupIdx, 1)
    }
    // 2) 按 priority 升序插入
    const insertIdx = this.queue.findIndex(q => q.priority > task.priority)
    if (insertIdx === -1) this.queue.push(task)
    else this.queue.splice(insertIdx, 0, task)
    // 3) 触发 pump
    this.pump()
  }

  /** 取消 pending 中所有任务；active 的任务不受影响（依赖 start 内部的 cancelled flag） */
  cancelAll(): void {
    const tasks = this.queue.splice(0)
    for (const t of tasks) t.cancel()
  }

  /** 取消 pending 中指定 pageNum 的任务；不存在返回 false */
  cancel(pageNum: number): boolean {
    const idx = this.queue.findIndex(q => q.pageNum === pageNum)
    if (idx < 0) return false
    this.queue[idx].cancel()
    this.queue.splice(idx, 1)
    return true
  }

  /** 等所有任务结束（pending + active），用于测试与组件 unmount 同步 */
  drain(): Promise<void> {
    if (this.queue.length === 0 && this.activeCount === 0) {
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      this.drainedResolvers.push(resolve)
    })
  }

  get pending(): number {
    return this.queue.length
  }

  get active(): number {
    return this.activeCount
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!
      this.activeCount++
      this.runItem(item)
    }
  }

  private runItem(item: RenderTask): void {
    // 同步调用 start：保证 enqueue 返回时 start 已触发（便于测试与监控）
    let p: Promise<void>
    try {
      p = item.start()
    } catch {
      // 同步抛错：当作立即完成
      this.finishOne()
      return
    }
    Promise.resolve(p)
      .catch(() => { /* swallow；start 内部应自行处理 renderTask.cancel */ })
      .finally(() => this.finishOne())
  }

  private finishOne(): void {
    this.activeCount--
    if (this.queue.length > 0) {
      this.pump()
    } else if (this.activeCount === 0) {
      // 全部跑完，唤醒 drain()
      const resolvers = this.drainedResolvers
      this.drainedResolvers = []
      for (const r of resolvers) r()
    }
  }
}
