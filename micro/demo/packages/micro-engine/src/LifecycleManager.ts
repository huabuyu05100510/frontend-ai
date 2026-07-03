/**
 * LifecycleManager —— mount / unmount / keep-alive (LRU)
 *
 * keep-alive 痛点（面试文档 8.16 ⑧）：
 *   - 内存爆炸：每个子应用保留 DOM + state，10 个就几百 MB
 *   - 不可见但活跃：切走时必须暂停定时器/WebSocket/监听器
 *
 * 解法：LRU(5) 上限，超过就销毁最久未用；销毁时 destroy iframe。
 */

export interface LifecycleEntry {
  appName: string
  iframe: HTMLIFrameElement
  mountedAt: number
}

export interface LifecycleCallbacks {
  onEvict?(entry: LifecycleEntry): void
  onShow?(entry: LifecycleEntry): void
  onHide?(entry: LifecycleEntry): void
}

export class LifecycleManager {
  /** 用 Map 的插入顺序天然表示 LRU */
  private alive = new Map<string, LifecycleEntry>()
  private _current: string | null = null

  constructor(
    private readonly limit = 5,
    private readonly cb: LifecycleCallbacks = {},
  ) {}

  /** 激活某 app：若已在 keep-alive 里则提到末位（最近用过），否则新建 */
  mount(appName: string, iframe: HTMLIFrameElement): LifecycleEntry {
    let entry = this.alive.get(appName)
    if (entry) {
      // LRU：删了再插到末位
      this.alive.delete(appName)
      entry.mountedAt = Date.now()
      this.alive.set(appName, entry)
      this.cb.onShow?.(entry)
    } else {
      entry = { appName, iframe, mountedAt: Date.now() }
      this.alive.set(appName, entry)
      // 超限：淘汰最久未用（Map 的第一个 key）
      if (this.alive.size > this.limit) {
        const oldestKey = this.alive.keys().next().value as string | undefined
        if (oldestKey) {
          const evicted = this.alive.get(oldestKey)!
          this.alive.delete(oldestKey)
          this.cb.onEvict?.(evicted)
        }
      }
    }
    this.showOnly(appName)
    this._current = appName
    return entry
  }

  /** 隐藏但不销毁（keep-alive） */
  hide(appName: string): void {
    const entry = this.alive.get(appName)
    if (!entry) return
    entry.iframe.style.display = 'none'
    entry.iframe.style.visibility = 'hidden'
    entry.iframe.style.left = '-9999px'
    this.cb.onHide?.(entry)
  }

  /** 销毁某个 app（从 keep-alive 移除 + iframe release） */
  destroy(appName: string): void {
    const entry = this.alive.get(appName)
    if (!entry) return
    this.alive.delete(appName)
    this.cb.onEvict?.(entry)
    if (this._current === appName) this._current = null
  }

  has(appName: string): boolean {
    return this.alive.has(appName)
  }

  list(): string[] {
    return Array.from(this.alive.keys())
  }

  current(): string | null {
    return this._current
  }

  clear(): void {
    for (const entry of this.alive.values()) {
      this.cb.onEvict?.(entry)
    }
    this.alive.clear()
    this._current = null
  }

  /** 只显示 appName，其余全隐藏（保证 LRU 列表里只有 1 个可见） */
  private showOnly(appName: string): void {
    for (const [name, entry] of this.alive) {
      if (name === appName) {
        entry.iframe.style.display = 'block'
        entry.iframe.style.visibility = 'visible'
        entry.iframe.style.left = '0'
      } else {
        entry.iframe.style.display = 'none'
        entry.iframe.style.visibility = 'hidden'
        entry.iframe.style.left = '-9999px'
      }
    }
  }
}
