import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scheduleIdleTask, schedulePrefetch } from '../idleScheduler'

// 工具：构造一个有 timeRemaining/didTimeout 的 fake deadline
function fakeDeadline(remaining: number, timeout = false): IdleDeadline {
  return { timeRemaining: () => remaining, didTimeout: timeout }
}

describe('scheduleIdleTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('无 requestIdleCallback → setTimeout fallback，timer 到时执行 fn', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const fn = vi.fn()
    scheduleIdleTask(fn)
    expect(fn).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('存在 requestIdleCallback → 优先使用，idle 触发时调 fn', () => {
    const fakeRic = vi.fn((cb: IdleRequestCallback) => {
      cb(fakeDeadline(50))
      return 1
    })
    vi.stubGlobal('requestIdleCallback', fakeRic)
    const fn = vi.fn()
    scheduleIdleTask(fn)
    expect(fakeRic).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel() 调用 cancelIdleCallback，阻止 fn 执行', () => {
    const fakeRic = vi.fn(() => 42)
    const fakeCic = vi.fn()
    vi.stubGlobal('requestIdleCallback', fakeRic)
    vi.stubGlobal('cancelIdleCallback', fakeCic)
    const fn = vi.fn()
    const cancel = scheduleIdleTask(fn)
    cancel()
    expect(fakeCic).toHaveBeenCalledWith(42)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel() 对 setTimeout fallback 也能阻止 fn 执行', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const fn = vi.fn()
    const cancel = scheduleIdleTask(fn)
    cancel()
    vi.runAllTimers()
    expect(fn).not.toHaveBeenCalled()
  })

  it('idle 时间不足（timeRemaining=0 且未超时）→ 不执行，自动重排', () => {
    let count = 0
    const fakeRic = vi.fn((cb: IdleRequestCallback) => {
      count++
      if (count === 1) {
        // 第一次：时间不够
        cb(fakeDeadline(0, false))
      } else {
        // 第二次：执行
        cb(fakeDeadline(50, false))
      }
      return count
    })
    vi.stubGlobal('requestIdleCallback', fakeRic)
    const fn = vi.fn()
    scheduleIdleTask(fn)
    expect(fakeRic).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('deadline.didTimeout=true → 强制执行（即使 timeRemaining=0）', () => {
    const fakeRic = vi.fn((cb: IdleRequestCallback) => {
      cb(fakeDeadline(0, true)) // 强制超时
      return 1
    })
    vi.stubGlobal('requestIdleCallback', fakeRic)
    const fn = vi.fn()
    scheduleIdleTask(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fakeRic).toHaveBeenCalledTimes(1) // 没触发重排
  })

  it('options.timeout 传递给 requestIdleCallback', () => {
    const fakeRic = vi.fn(() => 1)
    vi.stubGlobal('requestIdleCallback', fakeRic)
    scheduleIdleTask(() => {}, { timeout: 1234 })
    expect(fakeRic).toHaveBeenCalledWith(expect.any(Function), { timeout: 1234 })
  })

  it('fn 抛异常不影响 scheduler 自身（不被 reject 冒泡）', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    expect(() => {
      scheduleIdleTask(() => { throw new Error('boom') })
      vi.runAllTimers()
    }).not.toThrow()
  })

  it('cancel 后再次 cancel 安全（幂等）', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const cancel = scheduleIdleTask(vi.fn())
    cancel()
    expect(() => cancel()).not.toThrow()
  })

  it('多次 cancel 后即便 idle 触发也不执行', () => {
    let storedCb: unknown = null
    const fakeRic = (cb: unknown): number => {
      storedCb = cb
      return 1
    }
    vi.stubGlobal('requestIdleCallback', fakeRic)
    vi.stubGlobal('cancelIdleCallback', () => { /* 模拟取消后不再触发 */ })
    const fn = vi.fn()
    const cancel = scheduleIdleTask(fn)
    cancel()
    // 模拟浏览器忽略了 cancel（健壮性测试）：手动触发 cb
    if (storedCb) (storedCb as (d: { timeRemaining: () => number; didTimeout: boolean }) => void)(fakeDeadline(50))
    expect(fn).not.toHaveBeenCalled()
  })
})

// ============================================================================
// schedulePrefetch — 把一组 target 通过 idle 串行 + 窗口并发预取
// ============================================================================
describe('schedulePrefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 默认开启 rIC（每个 cb 立刻触发 deadLine=50ms，行为确定）
    const fakeRic = (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void): number => {
      cb(fakeDeadline(50))
      return 1
    }
    vi.stubGlobal('requestIdleCallback', fakeRic)
    vi.stubGlobal('cancelIdleCallback', () => { /* noop */ })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('只对 shouldFetch(t)=true 的 target 调用 doFetch', async () => {
    const fetches: number[] = []
    const shouldFetch = (n: number) => n % 2 === 1
    const doFetch = vi.fn(async (n: number) => { fetches.push(n) })
    const cancel = schedulePrefetch([1, 2, 3, 4, 5], shouldFetch, doFetch)
    // 让所有微任务跑完
    await vi.runAllTimersAsync()
    await Promise.resolve()
    expect(doFetch).toHaveBeenCalledTimes(3)
    expect(fetches.sort((a, b) => a - b)).toEqual([1, 3, 5])
    cancel()
  })

  it('所有 target 都 shouldFetch=false → 不调用 doFetch', async () => {
    const doFetch = vi.fn()
    const cancel = schedulePrefetch([1, 2, 3], () => false, doFetch)
    await vi.runAllTimersAsync()
    expect(doFetch).not.toHaveBeenCalled()
    cancel()
  })

  it('cancel() 后未开始的 target 不再执行', async () => {
    // 手动收集所有 idle callback
    let storedCbs: Array<(d: { timeRemaining: () => number; didTimeout: boolean }) => void> = []
    vi.stubGlobal('requestIdleCallback', (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
      storedCbs.push(cb)
      return storedCbs.length
    })
    vi.stubGlobal('cancelIdleCallback', () => { /* noop */ })

    const doFetch = vi.fn(async (_n: number) => {
      await new Promise(r => setTimeout(r, 5))
    })
    const cancel = schedulePrefetch([1, 2, 3, 4], () => true, doFetch, { window: 1 })

    // 第一次 idle：tryStart → 把 #1 的 idle cb 入队
    expect(storedCbs.length).toBe(1)
    storedCbs.shift()!({ timeRemaining: () => 50, didTimeout: false })

    // 现在 storedCbs 里是 #1 的 idle cb，触发它 → doFetch(1) 启动
    expect(storedCbs.length).toBe(1)
    storedCbs.shift()!({ timeRemaining: () => 50, didTimeout: false })
    expect(doFetch.mock.calls.length).toBe(1)

    // 让 doFetch 的 setTimeout(5) 完成 → finally 拉下一个
    await vi.advanceTimersByTimeAsync(5)
    // 此时 #2 的 idle cb 已入队
    expect(doFetch.mock.calls.length).toBe(1) // #2 还没跑

    // 取消剩余
    cancel()
    const beforeCancel = doFetch.mock.calls.length
    expect(beforeCancel).toBe(1)

    // 把已 schedule 但未执行的 idle 全部触发：cancelled 已置 true，不该跑 doFetch
    while (storedCbs.length) storedCbs.shift()!({ timeRemaining: () => 50, didTimeout: false })
    await vi.runAllTimersAsync()

    // 取消后再没有任何 doFetch 调用
    expect(doFetch.mock.calls.length).toBe(beforeCancel)
    // 全部 4 个里只跑过 1 个
    expect(doFetch.mock.calls.length).toBeLessThan(4)
  })

  it('默认串行调度：doFetch 在前一个 resolve 后才开始下一个', async () => {
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const doFetch = vi.fn(async (n: number) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`start-${n}`)
      await new Promise(r => setTimeout(r, 5))
      order.push(`end-${n}`)
      active--
    })
    schedulePrefetch([1, 2, 3], () => true, doFetch, { window: 1 })
    await vi.advanceTimersByTimeAsync(50)
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
    expect(maxActive).toBe(1)
  })

  it('window=N 时最多 N 个 doFetch 并发', async () => {
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const doFetch = vi.fn(async (n: number) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`s-${n}`)
      await new Promise(r => setTimeout(r, 10))
      order.push(`e-${n}`)
      active--
    })
    schedulePrefetch([1, 2, 3, 4, 5, 6], () => true, doFetch, { window: 3 })
    await vi.advanceTimersByTimeAsync(200)
    expect(maxActive).toBeLessThanOrEqual(3)
    // 所有 target 都应最终完成
    const starts = order.filter(x => x.startsWith('s-'))
    expect(starts).toHaveLength(6)
  })

  it('doFetch 抛错被吞，下一个 target 继续', async () => {
    const ok: number[] = []
    const doFetch = vi.fn(async (n: number) => {
      if (n === 2) throw new Error('boom')
      ok.push(n)
    })
    schedulePrefetch([1, 2, 3], () => true, doFetch, { window: 1 })
    await vi.advanceTimersByTimeAsync(50)
    expect(doFetch).toHaveBeenCalledTimes(3)
    expect(ok.sort((a, b) => a - b)).toEqual([1, 3])
  })

  it('空 targets 数组不报错，cancel 也是安全 noop', async () => {
    const doFetch = vi.fn()
    const cancel = schedulePrefetch([], () => true, doFetch)
    await vi.runAllTimersAsync()
    expect(doFetch).not.toHaveBeenCalled()
    expect(() => cancel()).not.toThrow()
  })
})
