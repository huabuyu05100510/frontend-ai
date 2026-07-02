import type { Segment } from '../shared/types'

type BatchCallback = (segments: Segment[]) => void | Promise<void>

/**
 * 视口优先翻译调度器（v2：失败回滚 + 超时重调度）
 *
 * 核心策略：
 * 1. IntersectionObserver 监听所有 segment 块
 * 2. 进入视口（含 300px 预加载边距）立即进入翻译队列
 * 3. 批次收集：最多 8 段或 2000 字符
 * 4. 调度后处于 scheduled 状态；markDone 才算完成
 * 5. onBatch 抛错或超时未 markDone → 自动回滚到 pending，可重新调度
 *
 * 根治卡死 bug：原来调度即 markTranslated，失败永不重试。
 *
 * W1-6：viewportGated=false 时禁用视口门控，所有 pending 段立即分批调度。
 * 用于 sidebar 模式 —— 译文进侧栏，用户没义务滚动原文去触发翻译。
 */
export class TranslationScheduler {
  private pending = new Map<string, Segment>()
  private scheduled = new Map<string, { batch: Segment[]; deadline: number }>()
  private done = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private observer: IntersectionObserver
  private timeoutTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private onBatch: BatchCallback,
    private batchSize = 8,
    private batchChars = 2000,
    private timeoutMs = 30_000,
    private viewportGated = true,
  ) {
    this.observer = new IntersectionObserver(
      entries => this.onIntersect(entries),
      { rootMargin: '300px 0px' },
    )
    // 周期性扫描超时，回滚卡死的批次
    this.timeoutTimer = setInterval(() => this.evictStale(), 5_000)
  }

  register(segments: Segment[]): void {
    for (const seg of segments) {
      if (this.viewportGated) this.observer.observe(seg.element)
      seg.element.setAttribute('data-xt-pending', seg.id)
      this.pending.set(seg.id, seg)
    }
    // 非视口门控模式：register 后立即排队翻译所有段
    if (!this.viewportGated) this.scheduleFlush()
  }

  /** 标记单段翻译完成 */
  markDone(segmentId: string): void {
    this.done.add(segmentId)
    this.pending.delete(segmentId)
    // 从 scheduled 池里清掉
    for (const [batchId, entry] of this.scheduled) {
      if (entry.batch.some(s => s.id === segmentId)) {
        const remaining = entry.batch.filter(s => s.id !== segmentId && !this.done.has(s.id))
        if (remaining.length === 0) {
          this.scheduled.delete(batchId)
        } else {
          entry.batch = remaining
        }
      }
    }
    // W2 修复：视口门控模式下，IntersectionObserver 在内容已加载/已滚动场景
    // 可能不再回调（lazy-load、已 in-view 但 isIntersecting 未变化等），
    // 导致首批完成后剩余 pending 永不调度。
    // 解决：markDone 总是尝试 scheduleFlush；flush 内的 rect 检查保证视口语义。
    if (this.pending.size > 0) this.scheduleFlush()
  }

  /** 别名：保持旧 API 兼容（内部转发到 markDone） */
  markTranslated(segmentId: string): void {
    this.markDone(segmentId)
  }

  /** W2-3: 周期重扫时跳过已完成的段 */
  isDone(segmentId: string): boolean {
    return this.done.has(segmentId)
  }

  destroy(): void {
    this.observer.disconnect()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.timeoutTimer) clearInterval(this.timeoutTimer)
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const id = entry.target.getAttribute('data-xt-pending')
      if (!id || this.done.has(id)) continue
      const seg = this.pending.get(id)
      if (seg) this.scheduleFlush()
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flush()
      this.flushTimer = null
    }, 16)
  }

  private flush(): void {
    const batch: Segment[] = []
    let chars = 0

    for (const [id, seg] of this.pending) {
      if (this.done.has(id)) continue
      if (this.scheduledBatchOf(id)) continue // 已在某批次中
      // 视口门控模式：跳过视口外的段；sidebar 模式无视口限制
      if (this.viewportGated) {
        const rect = seg.element.getBoundingClientRect()
        const inRange = rect.top < window.innerHeight + 300 && rect.bottom > -300
        if (!inRange) continue
      }

      batch.push(seg)
      chars += seg.text.length
      if (batch.length >= this.batchSize || chars >= this.batchChars) break
    }

    if (batch.length > 0) {
      const batchId = `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      this.scheduled.set(batchId, {
        batch: [...batch],
        deadline: Date.now() + this.timeoutMs,
      })
      console.log(
        `[xt:scheduler] flush ${batch.length} 段 pending=${this.pending.size} scheduled=${this.scheduled.size}`,
      )
      Promise.resolve(this.onBatch(batch)).catch(err => {
        console.warn(`[xt:scheduler] 批次 ${batchId} onBatch 抛错，回滚:`, err)
        this.rollback(batchId)
      })
    }
  }

  private scheduledBatchOf(segId: string): string | null {
    for (const [batchId, entry] of this.scheduled) {
      if (entry.batch.some(s => s.id === segId)) return batchId
    }
    return null
  }

  private rollback(batchId: string) {
    const entry = this.scheduled.get(batchId)
    if (!entry) return
    // 把未完成的 segment 重新放回 pending（pending 本来就有，只需清 scheduled 状态）
    const segCount = entry.batch.length
    this.scheduled.delete(batchId)
    console.log(`[xt:scheduler] rollback ${batchId} 段数=${segCount}`)
    // W2：rollback 后必须重新调度，否则这些段会永远卡在 pending（旧 bug）
    if (this.pending.size > 0) this.scheduleFlush()
  }

  private evictStale() {
    const now = Date.now()
    for (const [batchId, entry] of this.scheduled) {
      if (now > entry.deadline) {
        console.warn(`[xt:scheduler] 批次 ${batchId} 超时 ${this.timeoutMs}ms 未完成，回滚`)
        this.rollback(batchId)
      }
    }
  }
}
