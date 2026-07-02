// ============================================================================
// CollabDoc — LWW-Map CRDT（协同核心）
//   同步「操作」而非「字节」，与文件格式解耦。
//   满足交换律/结合律/幂等 → 离线编辑、乱序到达、重复投递均最终一致。
//   决胜规则：Lamport 时钟大者胜；平局按 clientId 字典序决胜。
// ============================================================================

interface Entry<T> {
  value: T | undefined
  ts: number // Lamport 时钟
  client: string
  deleted: boolean
}

export interface CollabUpdate<T> extends Entry<T> {
  key: string
}

export type CollabSnapshot<T> = Record<string, Entry<T>>

export class CollabDoc<T = unknown> {
  private store = new Map<string, Entry<T>>()
  private clock = 0

  constructor(public readonly clientId: string) {}

  private tick(): number {
    this.clock += 1
    return this.clock
  }

  set(key: string, value: T): CollabUpdate<T> {
    const entry: Entry<T> = { value, ts: this.tick(), client: this.clientId, deleted: false }
    this.store.set(key, entry)
    return { key, ...entry }
  }

  delete(key: string): CollabUpdate<T> {
    const entry: Entry<T> = { value: undefined, ts: this.tick(), client: this.clientId, deleted: true }
    this.store.set(key, entry)
    return { key, ...entry }
  }

  get(key: string): T | undefined {
    const e = this.store.get(key)
    if (!e || e.deleted) return undefined
    return e.value
  }

  /** 是否应被新条目覆盖（LWW 决胜） */
  private wins(incoming: Entry<T>, current: Entry<T> | undefined): boolean {
    if (!current) return true
    if (incoming.ts !== current.ts) return incoming.ts > current.ts
    return incoming.client > current.client
  }

  private applyEntry(key: string, incoming: Entry<T>): void {
    // 推进本地时钟，保证后续本地操作因果在后
    if (incoming.ts > this.clock) this.clock = incoming.ts
    const current = this.store.get(key)
    if (this.wins(incoming, current)) {
      this.store.set(key, { ...incoming })
    }
  }

  /** 合并单条远端更新 */
  applyUpdate(u: CollabUpdate<T>): void {
    const { key, ...entry } = u
    this.applyEntry(key, entry)
  }

  /** 合并整份快照（离线重连 / 全量同步） */
  merge(snap: CollabSnapshot<T>): void {
    for (const key of Object.keys(snap)) this.applyEntry(key, snap[key])
  }

  /** 全量状态（含墓碑），用于同步与一致性比对 */
  snapshot(): CollabSnapshot<T> {
    const out: CollabSnapshot<T> = {}
    for (const [k, e] of this.store) out[k] = { ...e }
    return out
  }

  /** 当前存活条目 */
  entries(): Array<[string, T]> {
    const out: Array<[string, T]> = []
    for (const [k, e] of this.store) {
      if (!e.deleted && e.value !== undefined) out.push([k, e.value])
    }
    return out
  }

  /**
   * 垃圾回收：清理可安全丢弃的墓碑条目。
   * minClock: 所有在线客户端中最小的 Lamport 时钟值（由服务端定期广播）。
   * 当某个墓碑的 ts ≤ minClock 时，说明所有客户端都已确认该删除，可安全移除。
   * 防止长期运行后墓碑无限累积导致内存/传输开销增长。
   */
  gc(minClock: number): void {
    for (const [k, e] of this.store) {
      if (e.deleted && e.ts <= minClock) {
        this.store.delete(k)
      }
    }
  }
}
