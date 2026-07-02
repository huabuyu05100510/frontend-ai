import type { VersionSnapshot } from '../core/types'

interface StoreConfig {
  maxSnapshots?: number  // default: 50
}

/** Content-addressed version store with LRU eviction and pinning. */
export class VersionStore {
  private snapshots = new Map<string, VersionSnapshot>()
  private order: string[] = []   // insertion order (oldest first)
  private readonly maxSnapshots: number

  constructor(config: StoreConfig = {}) {
    this.maxSnapshots = config.maxSnapshots ?? 50
  }

  /**
   * Create a snapshot of `content`.
   * Content-addressed: same content → same id (idempotent).
   * Returns the snapshot id.
   */
  snapshot(content: Record<string, unknown>, author: string, label?: string): string {
    const id = this._hash(content)

    if (this.snapshots.has(id)) return id

    const now = Date.now()
    const snap: VersionSnapshot = {
      id,
      label: label ?? this._autoLabel(now),
      content,
      timestamp: now,
      isPinned: false,
      author,
      stats: { wordCount: 0, charCount: 0 },
    }
    this.snapshots.set(id, snap)
    this.order.push(id)

    this._evict()
    return id
  }

  list(): VersionSnapshot[] {
    return [...this.order]
      .reverse()
      .map(id => this.snapshots.get(id)!)
      .filter(Boolean)
  }

  get(id: string): VersionSnapshot | undefined {
    return this.snapshots.get(id)
  }

  restore(id: string): Record<string, unknown> {
    const snap = this.snapshots.get(id)
    if (!snap) throw new Error(`Snapshot not found: ${id}`)
    return snap.content
  }

  pin(id: string): void {
    const snap = this.snapshots.get(id)
    if (snap) snap.isPinned = true
  }

  unpin(id: string): void {
    const snap = this.snapshots.get(id)
    if (snap) snap.isPinned = false
  }

  label(id: string, label: string): void {
    const snap = this.snapshots.get(id)
    if (snap) snap.label = label
  }

  delete(id: string): boolean {
    if (!this.snapshots.has(id)) return false
    this.snapshots.delete(id)
    this.order = this.order.filter(i => i !== id)
    return true
  }

  // ── Private ────────────────────────────────────────────────────────────
  private _evict(): void {
    while (this.order.length > this.maxSnapshots) {
      // Find oldest non-pinned snapshot
      const evictIdx = this.order.findIndex(id => !this.snapshots.get(id)?.isPinned)
      if (evictIdx === -1) break  // all pinned — can't evict
      const [evictId] = this.order.splice(evictIdx, 1)
      this.snapshots.delete(evictId)
    }
  }

  /** FNV-1a hash of JSON-serialized content for content-addressing */
  private _hash(content: Record<string, unknown>): string {
    const str = JSON.stringify(content, Object.keys(content).sort())
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = (h * 16777619) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }

  private _autoLabel(timestamp: number): string {
    const d = new Date(timestamp)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `自动保存 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
}
