import { describe, it, expect, vi } from 'vitest'
import { RenderQueue } from '../renderQueue'

// 工厂：生成一个 start/cancel 都被 spy 的 task
function makeTask(pageNum: number, priority: number, resolveAfter = 0) {
  const calls: string[] = []
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return {
    task: {
      pageNum,
      priority,
      start: vi.fn(async () => {
        calls.push('start')
        if (resolveAfter > 0) {
          await new Promise<void>(r => setTimeout(r, resolveAfter))
        }
        calls.push('end')
        resolve()
      }),
      cancel: vi.fn(() => { calls.push('cancel') }),
    },
    calls,
    promise,
  }
}

describe('RenderQueue', () => {
  it('maxConcurrent ≤ 0 抛错', () => {
    expect(() => new RenderQueue(0)).toThrow()
    expect(() => new RenderQueue(-1)).toThrow()
  })

  it('入队即按并发上限启动', async () => {
    const q = new RenderQueue(2)
    const t1 = makeTask(1, 1, 20)
    const t2 = makeTask(2, 2, 20)
    q.enqueue(t1.task)
    q.enqueue(t2.task)
    expect(q.active).toBe(2)
    expect(t1.calls).toEqual(['start'])
    expect(t2.calls).toEqual(['start'])
    await q.drain()
  })

  it('超过并发上限的任务排队等候，先完成先出', async () => {
    const q = new RenderQueue(1)
    const order: number[] = []
    const t1 = makeTask(1, 1, 5)
    const t2 = makeTask(2, 2, 5)
    const t3 = makeTask(3, 3, 5)
    t1.task.start = vi.fn(async () => { order.push(1); await new Promise(r => setTimeout(r, 5)); order.push(1.5) })
    t2.task.start = vi.fn(async () => { order.push(2); await new Promise(r => setTimeout(r, 5)); order.push(2.5) })
    t3.task.start = vi.fn(async () => { order.push(3); await new Promise(r => setTimeout(r, 5)); order.push(3.5) })
    q.enqueue(t1.task)
    q.enqueue(t2.task)
    q.enqueue(t3.task)
    expect(q.active).toBe(1)
    expect(q.pending).toBe(2)
    await q.drain()
    // 串行执行：1 → 2 → 3
    expect(order).toEqual([1, 1.5, 2, 2.5, 3, 3.5])
  })

  it('enqueue 相同 pageNum → pending 中旧任务被取消替换；active 不动', async () => {
    const q = new RenderQueue(2)
    const t1 = makeTask(1, 5, 100) // 占用 slot 1
    const t2 = makeTask(1, 1)      // 同一 pageNum 的 pending 占位（slot 2 留给 t3）
    const t3 = makeTask(2, 2)      // 占 slot 2
    q.enqueue(t1.task)             // active=1
    q.enqueue(t3.task)             // active=2，pending=[]
    q.enqueue(t2.task)             // 走 dedup：pending 无 pageNum=1 占位 → 直接入队
    // active 仍为 2（t1, t3 都在跑），t2 进 pending
    expect(q.active).toBe(2)
    expect(q.pending).toBe(1)
    expect(t2.calls).toEqual([])   // t2 未启动
    await q.drain()
  })

  it('enqueue 重复 pageNum 替换 pending 中的旧任务，旧任务被 cancel', async () => {
    const q = new RenderQueue(1)
    const t1 = makeTask(1, 1, 100) // 占用唯一一个 slot
    const tOld = makeTask(2, 5)    // pending（低优先级）
    const tNew = makeTask(2, 1)    // pending 替换（同 pageNum）
    q.enqueue(t1.task)
    q.enqueue(tOld.task)
    expect(q.pending).toBe(1)
    q.enqueue(tNew.task)
    // tOld 被 cancel 并替换为 tNew
    expect(tOld.calls).toContain('cancel')
    expect(q.pending).toBe(1)
    await q.drain()
  })

  it('按 priority 升序处理 pending 中的任务（小优先 = 高优先级，先跑）', async () => {
    const q = new RenderQueue(1) // 串行
    // 先用一个长任务占住 active slot，让后续入队的都进 pending
    const blocker = makeTask(0, 999, 30)
    q.enqueue(blocker.task) // 立即 active

    const order: number[] = []
    const mk = (n: number, pri: number) => {
      const t = makeTask(n, pri)
      t.task.start = vi.fn(async () => { order.push(n) })
      return t.task
    }
    q.enqueue(mk(5, 5))
    q.enqueue(mk(1, 1))
    q.enqueue(mk(3, 3))
    expect(q.pending).toBe(3)
    await q.drain()
    // pending 中按 priority 升序处理：1, 3, 5
    expect(order).toEqual([1, 3, 5])
  })

  it('cancel(pageNum) 取消 pending 中的任务并返回 true', () => {
    const q = new RenderQueue(1)
    const t1 = makeTask(1, 1, 100)
    const t2 = makeTask(2, 2)
    q.enqueue(t1.task)
    q.enqueue(t2.task)
    expect(q.pending).toBe(1)
    expect(q.cancel(2)).toBe(true)
    expect(t2.calls).toEqual(['cancel'])
    expect(q.pending).toBe(0)
  })

  it('cancel(pageNum) 对不存在的任务返回 false', () => {
    const q = new RenderQueue(2)
    expect(q.cancel(99)).toBe(false)
  })

  it('start 抛错被吞，下一个任务仍继续', async () => {
    const q = new RenderQueue(1)
    const order: number[] = []
    const tBad = makeTask(1, 1)
    tBad.task.start = vi.fn(async () => { order.push(1); throw new Error('boom') })
    const tOk = makeTask(2, 2)
    tOk.task.start = vi.fn(async () => { order.push(2) })
    q.enqueue(tBad.task)
    q.enqueue(tOk.task)
    await q.drain()
    expect(order).toEqual([1, 2])
    expect(q.active).toBe(0)
    expect(q.pending).toBe(0)
  })

  it('drain() 在没有任务时立即 resolve', async () => {
    const q = new RenderQueue(2)
    await q.drain()
  })

  it('concurrency=1 时任务严格串行执行：active 永远 ≤ 1，下一个任务在前一个完成后才启动', async () => {
    const q = new RenderQueue(1)
    const order: string[] = []
    const mk = (n: number) => {
      const t = makeTask(n, n, 5)
      t.task.start = vi.fn(async () => {
        order.push(`start-${n}`)
        // 在 start 执行期间，active 必须为 1
        expect(q.active).toBe(1)
        await new Promise(r => setTimeout(r, 5))
        order.push(`end-${n}`)
      })
      return t.task
    }
    q.enqueue(mk(1))
    q.enqueue(mk(2))
    q.enqueue(mk(3))
    q.enqueue(mk(4))
    expect(q.active).toBe(1)
    expect(q.pending).toBe(3)
    await q.drain()
    // 串行：start-1, end-1, start-2, end-2, start-3, end-3, start-4, end-4
    expect(order).toEqual([
      'start-1', 'end-1',
      'start-2', 'end-2',
      'start-3', 'end-3',
      'start-4', 'end-4',
    ])
    expect(q.active).toBe(0)
    expect(q.pending).toBe(0)
  })
})
