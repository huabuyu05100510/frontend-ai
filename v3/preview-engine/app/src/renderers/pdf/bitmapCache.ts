// ============================================================================
// BitmapCache — ImageBitmap / OffscreenCanvas 的 LRU 缓存
//   持有渲染好的页面位图；容量满时淘汰最久未使用并调 close() 释放 GPU 内存。
//   复用路径：用户来回滚动同一页时，命中缓存就免去 pdf.js 重新栅格化的开销。
//   与 PageLRU 并行：PageLRU 持有 worker 侧 PDFPageProxy，
//   BitmapCache 持有 main thread 侧位图。两层独立淘汰。
// ============================================================================

export interface BitmapLike {
  width: number
  height: number
  close(): void
}

export class BitmapCache<K, V extends BitmapLike = BitmapLike> {
  private map = new Map<K, V>()
  private readonly capacity: number

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`BitmapCache capacity must be > 0 (got ${capacity})`)
    }
    this.capacity = capacity
  }

  /** 命中时把节点提升到最新位置 */
  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  /** 写入；同 key 已存在则 close 旧的；容量满则淘汰最旧 */
  set(key: K, bmp: V): void {
    if (this.map.has(key)) {
      const old = this.map.get(key)!
      this.map.delete(key)
      safeClose(old)
    }
    this.map.set(key, bmp)
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as K
      const oldest = this.map.get(oldestKey)!
      this.map.delete(oldestKey)
      safeClose(oldest)
    }
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  /** 删除并 close；不存在返回 false */
  delete(key: K): boolean {
    const v = this.map.get(key)
    if (v === undefined) return false
    this.map.delete(key)
    safeClose(v)
    return true
  }

  clear(): void {
    for (const v of this.map.values()) safeClose(v)
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }

  keys(): K[] {
    return Array.from(this.map.keys())
  }
}

function safeClose(bmp: BitmapLike): void {
  try {
    bmp.close()
  } catch {
    /* swallow */
  }
}
