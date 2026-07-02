import { describe, it, expect } from 'vitest'
import { PagePool } from '../PagePool'

interface FakeTile {
  id: number
  freed: boolean
}

function makePool(capacity: number) {
  let created = 0
  const pool = new PagePool<FakeTile>({
    capacity,
    create: () => ({ id: created++, freed: false }),
    reset: (t) => {
      t.freed = false
    },
    dispose: (t) => {
      t.freed = true
    },
  })
  return { pool, createdCount: () => created }
}

describe('PagePool（对象池 + LRU，恒定内存核心）', () => {
  it('acquire 复用空闲对象，不无限新建', () => {
    const { pool, createdCount } = makePool(4)
    const a = pool.acquire(0)
    pool.release(0)
    const b = pool.acquire(1)
    expect(b).toBe(a) // 同一对象被复用
    expect(createdCount()).toBe(1)
  })

  it('活跃对象数永不超过容量（LRU 淘汰最久未用）', () => {
    const { pool } = makePool(3)
    for (let i = 0; i < 10; i++) pool.acquire(i)
    expect(pool.size()).toBeLessThanOrEqual(3)
  })

  it('超容量时淘汰最久未访问的 key 并触发 dispose', () => {
    const { pool } = makePool(2)
    const t0 = pool.acquire(0)
    pool.acquire(1)
    pool.acquire(2) // 触发淘汰 key 0（最久未用）
    expect(pool.has(0)).toBe(false)
    expect(t0.freed).toBe(true) // 被回收
    expect(pool.has(1)).toBe(true)
    expect(pool.has(2)).toBe(true)
  })

  it('touch/get 更新 LRU 顺序，保护热点', () => {
    const { pool } = makePool(2)
    pool.acquire(0)
    pool.acquire(1)
    pool.get(0) // 访问 0 → 0 变最新
    pool.acquire(2) // 淘汰最久未用 = 1
    expect(pool.has(0)).toBe(true)
    expect(pool.has(1)).toBe(false)
    expect(pool.has(2)).toBe(true)
  })

  it('release 回收对象进空闲链，acquire 新 key 优先复用', () => {
    const { pool, createdCount } = makePool(4)
    pool.acquire(0)
    pool.acquire(1)
    pool.release(0)
    pool.release(1)
    pool.acquire(2)
    pool.acquire(3)
    expect(createdCount()).toBe(2) // 全程仅创建 2 个对象
  })

  it('重复 acquire 同一 key 返回同一对象', () => {
    const { pool } = makePool(4)
    const a = pool.acquire(5)
    const b = pool.acquire(5)
    expect(b).toBe(a)
  })

  it('clear 释放全部并 dispose', () => {
    const { pool } = makePool(4)
    const t = pool.acquire(0)
    pool.clear()
    expect(pool.size()).toBe(0)
    expect(t.freed).toBe(true)
  })

  it('内存上限稳定：模拟滚动 1000 页（先回收离屏再渲染新页），对象复用', () => {
    const capacity = 10
    const { pool, createdCount } = makePool(capacity)
    for (let i = 0; i < 1000; i++) {
      if (i >= capacity) pool.release(i - capacity) // 离屏页回收（scheduler.recycle）
      pool.acquire(i) // 新页渲染（scheduler.visible）
    }
    expect(pool.size()).toBe(capacity)
    // 全程仅创建 capacity 个对象，其余靠复用 → 恒定内存
    expect(createdCount()).toBeLessThanOrEqual(capacity)
  })
})
