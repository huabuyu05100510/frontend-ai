import { describe, it, expect, vi } from 'vitest'
import { PageLRU } from '../pageLRU'

// 工厂：返回一个带 cleanup spy 的 mock page
function makePage() {
  const calls: string[] = []
  return {
    page: { cleanup: vi.fn(() => { calls.push('cleanup') }) },
    calls,
  }
}

describe('PageLRU', () => {
  it('基本 get/set/has', () => {
    const lru = new PageLRU(3)
    const { page } = makePage()
    lru.set(1, page)
    expect(lru.has(1)).toBe(true)
    expect(lru.get(1)).toBe(page)
    expect(lru.has(99)).toBe(false)
  })

  it('get 命中时把节点提升到最新位置', () => {
    const lru = new PageLRU(3)
    const p1 = makePage().page
    const p2 = makePage().page
    const p3 = makePage().page
    lru.set(1, p1)
    lru.set(2, p2)
    lru.set(3, p3)
    lru.get(1) // 命中后 1 应当变成最新
    expect(lru.keys()).toEqual([2, 3, 1])
  })

  it('超出容量时淘汰最久未使用并调 cleanup', () => {
    const lru = new PageLRU(2)
    const p1 = makePage()
    const p2 = makePage()
    const p3 = makePage()
    lru.set(1, p1.page)
    lru.set(2, p2.page)
    lru.set(3, p3.page) // 触发淘汰：1 最久未用
    expect(lru.has(1)).toBe(false)
    expect(p1.calls).toEqual(['cleanup'])
    expect(lru.has(2)).toBe(true)
    expect(lru.has(3)).toBe(true)
    expect(lru.size).toBe(2)
  })

  it('被 get 提升后不再被淘汰', () => {
    const lru = new PageLRU(2)
    const p1 = makePage()
    const p2 = makePage()
    const p3 = makePage()
    lru.set(1, p1.page)
    lru.set(2, p2.page)
    lru.get(1) // 提升 1，现在 2 是最久
    lru.set(3, p3.page) // 应当淘汰 2 而不是 1
    expect(lru.has(1)).toBe(true)
    expect(lru.has(2)).toBe(false)
    expect(p1.calls).toEqual([])
    expect(p2.calls).toEqual(['cleanup'])
  })

  it('touch() 把已有节点提升到最新，不调 cleanup', () => {
    const lru = new PageLRU(2)
    const p1 = makePage()
    const p2 = makePage()
    lru.set(1, p1.page)
    lru.set(2, p2.page)
    expect(lru.touch(1)).toBe(true)
    expect(p1.calls).toEqual([])
    expect(lru.keys()).toEqual([2, 1])
  })

  it('touch() 不存在的节点返回 false', () => {
    const lru = new PageLRU(2)
    expect(lru.touch(99)).toBe(false)
  })

  it('delete() 存在节点 → cleanup + 返回 true', () => {
    const lru = new PageLRU(2)
    const { page, calls } = makePage()
    lru.set(1, page)
    expect(lru.delete(1)).toBe(true)
    expect(calls).toEqual(['cleanup'])
    expect(lru.has(1)).toBe(false)
  })

  it('delete() 不存在节点 → 返回 false，不报错', () => {
    const lru = new PageLRU(2)
    expect(lru.delete(99)).toBe(false)
  })

  it('clear() 全部 cleanup', () => {
    const lru = new PageLRU(3)
    const p1 = makePage(), p2 = makePage(), p3 = makePage()
    lru.set(1, p1.page)
    lru.set(2, p2.page)
    lru.set(3, p3.page)
    lru.clear()
    expect(p1.calls).toEqual(['cleanup'])
    expect(p2.calls).toEqual(['cleanup'])
    expect(p3.calls).toEqual(['cleanup'])
    expect(lru.size).toBe(0)
  })

  it('set 同一 pageNum → 旧实例 cleanup 一次（不重复）', () => {
    const lru = new PageLRU(2)
    const p1 = makePage()
    const p2 = makePage()
    lru.set(1, p1.page)
    lru.set(1, p2.page)
    expect(p1.calls).toEqual(['cleanup'])
    expect(p2.calls).toEqual([])
    expect(lru.size).toBe(1)
    expect(lru.get(1)).toBe(p2.page)
  })

  it('capacity ≤ 0 抛错', () => {
    expect(() => new PageLRU(0)).toThrow()
    expect(() => new PageLRU(-1)).toThrow()
  })

  it('cleanup 抛同步异常被吞掉，set 仍正常完成', () => {
    const lru = new PageLRU(2)
    const bad = { cleanup: () => { throw new Error('boom') } }
    const p2 = makePage()
    const p3 = makePage()
    lru.set(1, bad)
    lru.set(2, p2.page)
    // 关键断言：set 不抛、bad 被淘汰（占着 slot）、p2 仍在（一次只淘汰最旧）
    expect(() => lru.set(3, p3.page)).not.toThrow()
    expect(lru.has(1)).toBe(false)
    expect(lru.has(2)).toBe(true)
    expect(lru.has(3)).toBe(true)
    expect(p2.calls).toEqual([]) // p2 尚未被淘汰
    // 触发 p2 淘汰，cleanup 正常执行
    lru.set(4, makePage().page)
    expect(p2.calls).toEqual(['cleanup'])
  })

  it('cleanup 返回 Promise 拒绝时不抛错，set 正常完成', async () => {
    const lru = new PageLRU(2)
    const p1 = { cleanup: () => Promise.reject(new Error('async boom')) }
    const p2 = makePage()
    const p3 = makePage()
    lru.set(1, p1 as any)
    lru.set(2, p2.page)
    expect(() => lru.set(3, p3.page)).not.toThrow()
    expect(lru.has(1)).toBe(false) // bad 被淘汰
    expect(lru.has(2)).toBe(true)
    expect(lru.has(3)).toBe(true)
    // 等 microtask 跑完，确认没有 unhandled rejection 冒到 vitest
    await new Promise(r => setTimeout(r, 0))
    expect(p2.calls).toEqual([]) // p2 尚未被淘汰
  })
})
