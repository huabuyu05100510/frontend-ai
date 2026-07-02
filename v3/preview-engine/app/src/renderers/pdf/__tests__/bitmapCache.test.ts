import { describe, it, expect, vi } from 'vitest'
import { BitmapCache } from '../bitmapCache'

function makeBmp(w = 100, h = 100) {
  const calls: string[] = []
  return {
    bmp: {
      width: w,
      height: h,
      close: vi.fn(() => { calls.push('close') }),
    },
    calls,
  }
}

describe('BitmapCache', () => {
  it('基本 get/set/has/delete', () => {
    const c = new BitmapCache<string>(3)
    const { bmp } = makeBmp()
    c.set('a', bmp)
    expect(c.has('a')).toBe(true)
    expect(c.get('a')).toBe(bmp)
    expect(c.delete('a')).toBe(true)
    expect(c.has('a')).toBe(false)
    expect(c.delete('a')).toBe(false)
  })

  it('get 命中时把节点提升到最新', () => {
    const c = new BitmapCache<string>(3)
    const a = makeBmp().bmp, b = makeBmp().bmp, d = makeBmp().bmp
    c.set('a', a)
    c.set('b', b)
    c.set('d', d)
    c.get('a') // 提升
    expect(c.keys()).toEqual(['b', 'd', 'a'])
  })

  it('超出容量时淘汰最久未使用并调 close', () => {
    const c = new BitmapCache<string>(2)
    const a = makeBmp(), b = makeBmp(), d = makeBmp()
    c.set('a', a.bmp)
    c.set('b', b.bmp)
    c.set('d', d.bmp) // 淘汰 a
    expect(a.calls).toEqual(['close'])
    expect(b.calls).toEqual([])
    expect(d.calls).toEqual([])
    expect(c.has('a')).toBe(false)
    expect(c.size).toBe(2)
  })

  it('被 get 提升后不再被淘汰', () => {
    const c = new BitmapCache<string>(2)
    const a = makeBmp(), b = makeBmp(), d = makeBmp()
    c.set('a', a.bmp)
    c.set('b', b.bmp)
    c.get('a') // 提升 a，现在 b 最久
    c.set('d', d.bmp) // 淘汰 b
    expect(a.calls).toEqual([])
    expect(b.calls).toEqual(['close'])
  })

  it('set 同一 key → 旧 bitmap close 一次', () => {
    const c = new BitmapCache<string>(2)
    const a = makeBmp(), b = makeBmp()
    c.set('a', a.bmp)
    c.set('a', b.bmp)
    expect(a.calls).toEqual(['close'])
    expect(b.calls).toEqual([])
    expect(c.size).toBe(1)
  })

  it('delete 存在 → close + 返回 true', () => {
    const c = new BitmapCache<string>(2)
    const a = makeBmp()
    c.set('a', a.bmp)
    expect(c.delete('a')).toBe(true)
    expect(a.calls).toEqual(['close'])
  })

  it('clear() 全部 close', () => {
    const c = new BitmapCache<string>(3)
    const a = makeBmp(), b = makeBmp(), d = makeBmp()
    c.set('a', a.bmp)
    c.set('b', b.bmp)
    c.set('d', d.bmp)
    c.clear()
    expect(a.calls).toEqual(['close'])
    expect(b.calls).toEqual(['close'])
    expect(d.calls).toEqual(['close'])
    expect(c.size).toBe(0)
  })

  it('close 抛异常被吞，不影响其他淘汰', () => {
    const c = new BitmapCache<string>(2)
    const badClose = vi.fn(() => { throw new Error('boom') })
    const bad = { width: 1, height: 1, close: badClose }
    const b = makeBmp()
    const d = makeBmp()
    c.set('a', bad)
    c.set('b', b.bmp)
    // set('d') 触发淘汰 a（bad）；close 抛错被吞，b 仍在
    expect(() => c.set('d', d.bmp)).not.toThrow()
    expect(badClose).toHaveBeenCalledTimes(1)
    expect(b.calls).toEqual([])
    // 再加一个触发 b 淘汰 → b.close 正常调用
    c.set('e', makeBmp().bmp)
    expect(b.calls).toEqual(['close'])
  })

  it('capacity ≤ 0 抛错', () => {
    expect(() => new BitmapCache(0)).toThrow()
    expect(() => new BitmapCache(-1)).toThrow()
  })

  it('支持自定义 key 类型（数字 pageNum）', () => {
    const c = new BitmapCache<number>(2)
    const a = makeBmp().bmp, b = makeBmp().bmp, d = makeBmp().bmp
    c.set(1, a)
    c.set(2, b)
    c.set(3, d)
    expect(c.get(2)).toBe(b)
    expect(c.has(1)).toBe(false) // 1 被淘汰
  })
})
