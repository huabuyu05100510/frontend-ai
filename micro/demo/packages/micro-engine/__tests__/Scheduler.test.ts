import { describe, expect, it, vi, afterEach } from 'vitest'
import { Scheduler } from '../src/Scheduler'

describe('Scheduler 边界场景', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('原生 ric 路径：cb 同步触发时 task 立即跑', () => {
    vi.stubGlobal(
      'requestIdleCallback',
      (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
        cb({ timeRemaining: () => 50, didTimeout: false })
        return 0
      },
    )
    const s = new Scheduler()
    const task = vi.fn()
    s.schedule(task)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('rAF+MessageChannel 路径：删 ric 后用 fallback 跑完 task', async () => {
    // 删 ric，强制 Scheduler 走 rAF+MC 路径
    const g = globalThis as any
    const savedRic = g.requestIdleCallback
    delete g.requestIdleCallback
    // rAF stub：同步触发，等同「下一帧」
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      cb()
      return 0
    })
    const s = new Scheduler()
    const task = vi.fn()
    s.schedule(task)
    // MessageChannel port1.onmessage 是 macrotask，需让出主线程一次
    await new Promise((r) => setTimeout(r, 0))
    expect(task).toHaveBeenCalledTimes(1)
    g.requestIdleCallback = savedRic
  })

  it('setTimeout 兜底：删 ric / rAF / MessageChannel 后跑完 task', async () => {
    vi.useFakeTimers()
    const g = globalThis as any
    const saved = { ric: g.requestIdleCallback, raf: g.requestAnimationFrame, mc: g.MessageChannel }
    delete g.requestIdleCallback
    delete g.requestAnimationFrame
    delete g.MessageChannel
    const s = new Scheduler()
    const task = vi.fn()
    s.schedule(task)
    // setTimeout(0) 受 fake timers 控制
    await vi.advanceTimersByTimeAsync(10)
    expect(task).toHaveBeenCalledTimes(1)
    Object.assign(g, saved)
  })

  it('预算耗尽 → 重新调度：第一次 timeRemaining=0 不跑，第二次 50 才跑', () => {
    const seq = [0, 50]
    let calls = 0
    vi.stubGlobal(
      'requestIdleCallback',
      (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
        calls++
        const tr = seq[calls - 1] ?? 50
        cb({ timeRemaining: () => tr, didTimeout: false })
        return calls
      },
    )
    const s = new Scheduler()
    const task = vi.fn()
    s.schedule(task)
    // 第一次 flush 看到 remaining=0 → 重新 kick → 第二次 ric → 跑
    expect(task).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  it('timeout 强制执行：任务排队超过 timeout 后 didTimeout=true', () => {
    // 手动控制 performance.now，避免 fake timers 行为不一致
    let perfNow = 0
    vi.stubGlobal('performance', { now: () => perfNow })
    let ricCb: ((d: { timeRemaining: () => number; didTimeout: boolean }) => void) | null = null
    vi.stubGlobal(
      'requestIdleCallback',
      (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
        // 不立即触发，先捕获 cb，由测试控制时机
        ricCb = cb
        return 0
      },
    )
    const s = new Scheduler()
    const task = vi.fn()
    s.schedule(task, { timeout: 50 })
    expect(task).not.toHaveBeenCalled()
    // 推进 performance.now 超过 timeout（任务 insertedAt=0）
    perfNow = 100
    // 现在手动触发 flush
    ricCb!({ timeRemaining: () => 50, didTimeout: false })
    expect(task).toHaveBeenCalledTimes(1)
    expect(task.mock.calls[0][0]).toMatchObject({ didTimeout: true })
  })

  it('cancel 后 task 不执行', () => {
    let ricCb: ((d: { timeRemaining: () => number; didTimeout: boolean }) => void) | null = null
    vi.stubGlobal(
      'requestIdleCallback',
      (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
        ricCb = cb
        return 0
      },
    )
    const s = new Scheduler()
    const task = vi.fn()
    const cancel = s.schedule(task)
    cancel()
    // 即使触发 flush，队列已空
    ricCb!({ timeRemaining: () => 50, didTimeout: false })
    expect(task).not.toHaveBeenCalled()
  })
})
