// ============================================================================
// PageLRU — PDF 页面引用的 LRU 缓存
//   持有 PDFPageProxy，按 pageNum 去重；容量满时淘汰最久未使用的页并调
//   cleanup() 释放 worker 侧资源（解码后的字体、图像、内部 cache）。
//   这是根治"PDF 越翻越慢"的关键：getPage() 后若页面离开可见窗口，
//   必须 cleanup()，否则 worker 内存线性增长，最终 fallback 到主线程更慢。
// ============================================================================

export interface CleanupCapable {
  cleanup(): void | Promise<void>
}

export class PageLRU<P extends CleanupCapable = CleanupCapable> {
  private map = new Map<number, P>()
  private readonly capacity: number

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`PageLRU capacity must be > 0 (got ${capacity})`)
    }
    this.capacity = capacity
  }

  /** 命中时把节点提升到最新位置（最近使用） */
  get(pageNum: number): P | undefined {
    const v = this.map.get(pageNum)
    if (v === undefined) return undefined
    // Map 保持插入顺序：删了再插就变成最新
    this.map.delete(pageNum)
    this.map.set(pageNum, v)
    return v
  }

  /** 写入；同 pageNum 已存在则 cleanup 旧实例；容量满则淘汰最旧 */
  set(pageNum: number, page: P): void {
    if (this.map.has(pageNum)) {
      const old = this.map.get(pageNum)!
      this.map.delete(pageNum)
      safeCleanup(old)
    }
    this.map.set(pageNum, page)
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as number
      const oldest = this.map.get(oldestKey)!
      this.map.delete(oldestKey)
      safeCleanup(oldest)
    }
  }

  /** 把已有节点提升到最新；不存在则返回 false */
  touch(pageNum: number): boolean {
    const v = this.map.get(pageNum)
    if (v === undefined) return false
    this.map.delete(pageNum)
    this.map.set(pageNum, v)
    return true
  }

  has(pageNum: number): boolean {
    return this.map.has(pageNum)
  }

  /** 删除并 cleanup；不存在返回 false */
  delete(pageNum: number): boolean {
    const v = this.map.get(pageNum)
    if (v === undefined) return false
    this.map.delete(pageNum)
    safeCleanup(v)
    return true
  }

  /** 全部 cleanup 并清空（组件 unmount 时调用） */
  clear(): void {
    for (const v of this.map.values()) safeCleanup(v)
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }

  /** 从最久未使用到最新的 pageNum 列表 */
  keys(): number[] {
    return Array.from(this.map.keys())
  }
}

// cleanup 抛异常（同步 / Promise 拒绝）都不能影响后续淘汰
function safeCleanup(p: CleanupCapable): void {
  try {
    const r = p.cleanup()
    if (r && typeof (r as { catch?: unknown }).catch === 'function') {
      ;(r as Promise<void>).catch(() => { /* swallow */ })
    }
  } catch {
    /* swallow */
  }
}
