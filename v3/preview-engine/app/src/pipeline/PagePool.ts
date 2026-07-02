// ============================================================================
// PagePool — 对象池 + LRU（恒定内存的核心）
//   页/瓦片的 Canvas/纹理离开视口后不销毁，进空闲链复用，
//   避免反复 new 触发 GC 抖动；活跃数超容量则 LRU 淘汰 + dispose。
// ============================================================================

export interface PagePoolOptions<T> {
  capacity: number
  create: () => T
  /** 复用前重置对象状态 */
  reset?: (obj: T) => void
  /** 彻底销毁（释放 GPU 纹理等） */
  dispose?: (obj: T) => void
}

export class PagePool<T> {
  private capacity: number
  private create: () => T
  private reset: (obj: T) => void
  private dispose: (obj: T) => void

  /** 活跃：key → obj，用 Map 的插入顺序模拟 LRU（最旧在前） */
  private active = new Map<number, T>()
  /** 空闲对象链（可复用） */
  private free: T[] = []

  constructor(opts: PagePoolOptions<T>) {
    this.capacity = opts.capacity
    this.create = opts.create
    this.reset = opts.reset ?? (() => {})
    this.dispose = opts.dispose ?? (() => {})
  }

  size(): number {
    return this.active.size
  }

  has(key: number): boolean {
    return this.active.has(key)
  }

  /** 访问并提升为最新（LRU touch），不存在返回 undefined */
  get(key: number): T | undefined {
    const obj = this.active.get(key)
    if (obj === undefined) return undefined
    this.active.delete(key)
    this.active.set(key, obj) // 重新插入到末尾 = 最新
    return obj
  }

  /** 取得 key 对应对象（已存在则复用并 touch；否则从空闲链取或新建） */
  acquire(key: number): T {
    const existing = this.get(key)
    if (existing !== undefined) return existing

    const obj = this.free.pop() ?? this.create()
    this.reset(obj)
    // 先淘汰再 set，确保 active.size 始终 ≤ capacity
    if (this.active.size >= this.capacity) this.evictLRU()
    this.active.set(key, obj)
    return obj
  }

  /** 归还对象到空闲链（离屏回收，可被后续 acquire 复用） */
  release(key: number): void {
    const obj = this.active.get(key)
    if (obj === undefined) return
    this.active.delete(key)
    this.reset(obj)
    this.free.push(obj)
  }

  private evictLRU(): void {
    const oldest = this.active.keys().next().value
    if (oldest === undefined) return
    const obj = this.active.get(oldest)!
    this.active.delete(oldest)
    this.dispose(obj) // 超容量 → 彻底释放
  }

  clear(): void {
    for (const obj of this.active.values()) this.dispose(obj)
    for (const obj of this.free) this.dispose(obj)
    this.active.clear()
    this.free = []
  }
}
