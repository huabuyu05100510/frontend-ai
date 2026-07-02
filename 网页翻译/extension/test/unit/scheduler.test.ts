import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TranslationScheduler } from '../../src/content/scheduler'
import type { Segment } from '../../src/shared/types'

// ─── Stub: IntersectionObserver ─────────────────────────────
class IOStub {
  cb: IntersectionObserverCallback
  targets = new Set<Element>()
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
  }
  observe(t: Element) {
    this.targets.add(t)
  }
  unobserve(t: Element) {
    this.targets.delete(t)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
  trigger(targets: Element[], intersecting: boolean) {
    const entries = targets.map(target => ({
      target,
      isIntersecting: intersecting,
      intersectionRatio: intersecting ? 1 : 0,
      time: 0,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
    }))
    this.cb(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

function makeSegments(n: number): { segments: Segment[] } {
  const segments: Segment[] = []
  for (let i = 0; i < n; i++) {
    const el = document.createElement('p')
    el.textContent = `segment-${i}`
    el.getBoundingClientRect = () => ({
      top: 100, bottom: 200, left: 0, right: 100,
      width: 100, height: 100, x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect)
    document.body.appendChild(el)
    segments.push({
      id: `s${i}`,
      text: `text-${i}`,
      element: el,
      role: 'body',
    })
  }
  return { segments }
}

describe('TranslationScheduler — 失败回滚 + 重调度', () => {
  beforeEach(() => {
    // jsdom 无 IntersectionObserver，注入 stub
    // @ts-expect-error override global
    global.IntersectionObserver = class extends IOStub {}
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('onBatch 抛错时，segment 被回滚到 pending，可重新调度', async () => {
    let attempt = 0
    const onBatch = vi.fn(async (_batch: Segment[]) => {
      attempt++
      if (attempt === 1) throw new Error('api down')
    })

    const scheduler = new TranslationScheduler(onBatch, 4, 10000)
    const { segments } = makeSegments(2)
    const io = (scheduler as unknown as { observer: IOStub }).observer

    scheduler.register(segments)
    io.trigger(segments.map(s => s.element), true)
    await new Promise(r => setTimeout(r, 80))

    // W2 修复：rollback 后自动 scheduleFlush → 立即重试一次（attempt 2 成功）
    // → onBatch 共 2 次，第二次的 batch 仍在 scheduled 池里（未 markDone）
    expect(onBatch).toHaveBeenCalledTimes(2)
    const scheduled1 = (scheduler as unknown as { scheduled: Map<string, unknown> }).scheduled
    expect(scheduled1.size).toBe(1)
    const pending1 = (scheduler as unknown as { pending: Map<string, unknown> }).pending
    expect(pending1.size).toBe(2)

    scheduler.destroy()
  })

  it('已 markDone 的 segment 不再重新调度', async () => {
    const onBatch = vi.fn(async (_b: Segment[]) => {})
    const scheduler = new TranslationScheduler(onBatch, 4, 10000)
    const { segments } = makeSegments(1)
    const io = (scheduler as unknown as { observer: IOStub }).observer

    scheduler.register(segments)
    io.trigger(segments.map(s => s.element), true)
    await new Promise(r => setTimeout(r, 50))

    scheduler.markDone(segments[0].id)
    io.trigger(segments.map(s => s.element), true)
    await new Promise(r => setTimeout(r, 50))

    expect(onBatch).toHaveBeenCalledTimes(1)
    scheduler.destroy()
  })

  it('超时未返回的 segment 自动回滚（30s 超时）', async () => {
    vi.useFakeTimers()
    const onBatch = vi.fn(async (_b: Segment[]) => {
      return new Promise(() => {}) // 永不 markDown
    })
    const scheduler = new TranslationScheduler(onBatch, 4, 10000, 30_000)
    const { segments } = makeSegments(1)
    const io = (scheduler as unknown as { observer: IOStub }).observer

    scheduler.register(segments)
    io.trigger(segments.map(s => s.element), true)
    await vi.advanceTimersByTimeAsync(50) // flush 16ms

    expect(onBatch).toHaveBeenCalledTimes(1)

    // 推进 36s —— 触发 evictStale（5s 周期 + 30s 超时）
    await vi.advanceTimersByTimeAsync(36_000)

    // W2 修复：rollback 自动 scheduleFlush → 立即重试（同样永不完成）
    // scheduled 池有新批次（重试中的），onBatch 被调用 2 次
    const scheduled = (scheduler as unknown as { scheduled: Map<string, unknown> }).scheduled
    expect(scheduled.size).toBe(1)
    expect(onBatch).toHaveBeenCalledTimes(2)

    scheduler.destroy()
    vi.useRealTimers()
  })

  it('viewportGated 模式：第一批 markDone 后，剩余在视口内的 pending 应自动调度下一批', async () => {
    // 复现 W2 真实 bug：BBC 151 段，第一批 8 段翻译完后，
    // IntersectionObserver 不再触发新批次 → 后续 143 段永远卡住
    const onBatch = vi.fn(async (_b: Segment[]) => {})
    // viewportGated=true（第 5 个参数）
    const scheduler = new TranslationScheduler(onBatch, 8, 10000, 30_000, true)
    const { segments } = makeSegments(20)  // 20 段全部在视口内（makeSegments 设 top=100）
    const io = (scheduler as unknown as { observer: IOStub }).observer

    scheduler.register(segments)
    // 第一次触发视口：应调度前 8 段
    io.trigger(segments.map(s => s.element), true)
    await new Promise(r => setTimeout(r, 50))
    expect(onBatch).toHaveBeenCalledTimes(1)
    expect(onBatch.mock.calls[0][0].length).toBe(8)

    // 模拟第一批全部 markDone
    for (const s of onBatch.mock.calls[0][0]) {
      scheduler.markDone(s.id)
    }
    await new Promise(r => setTimeout(r, 50))

    // 期望：第二批 8 段应被自动调度（无需新的视口触发）
    expect(onBatch).toHaveBeenCalledTimes(2)
    expect(onBatch.mock.calls[1][0].length).toBe(8)

    scheduler.destroy()
  })
})
