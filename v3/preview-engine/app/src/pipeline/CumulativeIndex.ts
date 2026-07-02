import type { Range } from '../kernel/types'

// ============================================================================
// CumulativeIndex — 累计前缀和 + 二分查找
//   把「视口 → 可见单元区间」从 O(n) 线性扫描降到 O(log n)，
//   支撑百万行表格 / 千页文档的丝滑滚动。
// ============================================================================

export class CumulativeIndex {
  private prefix: Float64Array // prefix[i] = 前 i 个单元的累计尺寸；长度 n+1
  private sizes: Float64Array
  private dirty = false
  private dirtyFrom = 0

  constructor(count: number, sizeOf: (i: number) => number) {
    this.sizes = new Float64Array(count)
    this.prefix = new Float64Array(count + 1)
    for (let i = 0; i < count; i++) this.sizes[i] = sizeOf(i)
    this.rebuild(0)
  }

  private rebuild(from: number): void {
    for (let i = from; i < this.sizes.length; i++) {
      this.prefix[i + 1] = this.prefix[i] + this.sizes[i]
    }
    this.dirty = false
  }

  private ensureClean(): void {
    if (this.dirty) this.rebuild(this.dirtyFrom)
  }

  get count(): number {
    return this.sizes.length
  }

  totalSize(): number {
    this.ensureClean()
    return this.prefix[this.sizes.length]
  }

  /** 第 i 个单元的起始偏移 */
  offsetOf(i: number): number {
    this.ensureClean()
    return this.prefix[i]
  }

  /** 更新某单元尺寸（懒重建：记录最早脏点，下次查询时重算） */
  setSize(i: number, size: number): void {
    if (this.sizes[i] === size) return
    this.sizes[i] = size
    if (!this.dirty) {
      this.dirty = true
      this.dirtyFrom = i
    } else {
      this.dirtyFrom = Math.min(this.dirtyFrom, i)
    }
  }

  /** 二分：找到 offset 落在哪个单元（返回单元下标） */
  indexAt(offset: number): number {
    this.ensureClean()
    const n = this.sizes.length
    if (n === 0) return -1
    if (offset <= 0) return 0
    const total = this.prefix[n]
    if (offset >= total) return n - 1

    // 找最大的 i 使 prefix[i] <= offset
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.prefix[mid] <= offset) lo = mid + 1
      else hi = mid
    }
    return lo - 1
  }

  /** 视口 [scrollTop, scrollTop+height) 覆盖的单元区间（闭区间） */
  rangeForViewport(scrollTop: number, height: number): Range {
    this.ensureClean()
    const n = this.sizes.length
    if (n === 0) return { start: 0, end: -1 }
    const start = this.indexAt(scrollTop)
    const end = this.indexAt(scrollTop + height - 1)
    return { start, end }
  }
}
