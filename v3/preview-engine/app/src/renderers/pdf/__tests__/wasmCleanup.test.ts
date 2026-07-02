import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WasmCleanupScheduler } from '../wasmCleanup'

describe('WasmCleanupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // rIC 立刻触发，模拟浏览器空闲
    const fakeRic = (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void): number => {
      cb({ timeRemaining: () => 50, didTimeout: false })
      return 1
    }
    vi.stubGlobal('requestIdleCallback', fakeRic)
    vi.stubGlobal('cancelIdleCallback', () => { /* noop */ })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('达到 threshold 后调度 cleanup 并重置计数器', async () => {
    const cleanup = vi.fn()
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 3, cleanup })
    s.recordRender()
    s.recordRender()
    s.recordRender()
    // cleanup 通过 idle 触发
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('未达 threshold 不触发 cleanup', async () => {
    const cleanup = vi.fn()
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 5, cleanup })
    s.recordRender()
    s.recordRender()
    s.recordRender()
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('cleanup 是 async 时也正确 await（按 promise resolve 才视为完成）', async () => {
    let resolveFn!: () => void
    const cleanup = vi.fn(() => new Promise<void>(r => { resolveFn = r }))
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 2, cleanup })
    s.recordRender()
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(1)
    // resolve 之后下一次 recordRender 才重新累积
    resolveFn()
    // 让 .finally 微任务链跑完
    for (let i = 0; i < 5; i++) await Promise.resolve()
    // 让 intervalMs 不阻塞：注入 now 让 elapsed 看起来已过间隔
    const later = Date.now() + 2000
    ;(s as unknown as { now: () => number }).now = () => later
    s.recordRender()
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('cleanup 抛异常被吞，不影响 scheduler（下次 recordRender 仍可触发）', async () => {
    const cleanup = vi.fn(() => { throw new Error('cleanup boom') })
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 2, cleanup })
    s.recordRender()
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(1)
    // 不抛异常；counter 已重置；intervalMs 不阻塞（手动模拟时间推进）
    const later = Date.now() + 2000
    ;(s as unknown as { now: () => number }).now = () => later
    s.recordRender()
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('cleanup 是 rejected Promise 也被吞，不阻止下次累积', async () => {
    const cleanup = vi.fn(() => Promise.reject(new Error('rejected')))
    // 抑制 unhandled rejection 警告
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 1, cleanup })
      s.recordRender()
      await vi.runAllTimersAsync()
      // 等 microtask drain
      await Promise.resolve()
      await Promise.resolve()
      expect(cleanup).toHaveBeenCalledTimes(1)
      // counter 已重置 → 下一次 recordRender 可再次触发
      const later = Date.now() + 2000
      ;(s as unknown as { now: () => number }).now = () => later
      s.recordRender()
      await vi.runAllTimersAsync()
      await Promise.resolve()
      expect(cleanup).toHaveBeenCalledTimes(2)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('cancel() 阻止 pending 的 cleanup 执行', async () => {
    // rIC 不立即触发；把 cb 存起来
    const cbRef: { current: ((d: { timeRemaining: () => number; didTimeout: boolean }) => void) | null } = { current: null }
    vi.stubGlobal('requestIdleCallback', (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
      cbRef.current = cb
      return 1
    })
    vi.stubGlobal('cancelIdleCallback', () => { cbRef.current = null })
    const cleanup = vi.fn()
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 1, cleanup })
    s.recordRender()
    // 阈值已到，cleanup 已 schedule 但未触发
    expect(cleanup).not.toHaveBeenCalled()
    s.cancel()
    // 手动触发 cbRef.current（模拟浏览器忽略 cancel）：cancelled 应阻止
    const fn = cbRef.current
    if (fn) fn({ timeRemaining: () => 50, didTimeout: false })
    await vi.runAllTimersAsync()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('cleanup 后再 recordRender 重新累积到 threshold', async () => {
    const cleanup = vi.fn()
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 2, cleanup })
    s.recordRender()
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(1)
    // counter 已重置；推进虚拟时间使 intervalMs 不阻塞
    const later = Date.now() + 2000
    ;(s as unknown as { now: () => number }).now = () => later
    s.recordRender()
    expect(cleanup).toHaveBeenCalledTimes(1) // 还差一次
    s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('默认值：threshold=10, intervalMs=30000', async () => {
    const cleanup = vi.fn()
    const s = new WasmCleanupScheduler({ cleanup })
    for (let i = 0; i < 9; i++) s.recordRender()
    await vi.runAllTimersAsync()
    expect(cleanup).not.toHaveBeenCalled()
    s.recordRender() // 第 10 次
    await vi.runAllTimersAsync()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('多次 cancel 幂等', async () => {
    const cleanup = vi.fn()
    const s = new WasmCleanupScheduler({ intervalMs: 1000, threshold: 1, cleanup })
    s.recordRender()
    expect(() => { s.cancel(); s.cancel() }).not.toThrow()
  })
})