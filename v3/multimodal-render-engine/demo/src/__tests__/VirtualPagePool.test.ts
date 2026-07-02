import { describe, test, expect, vi, beforeEach } from 'vitest'
import { VirtualPagePool } from '../pipeline/VirtualPagePool'

// 模拟 canvas 环境：HTMLCanvasElement.width = 0 用于释放 GPU 纹理
// jsdom 已提供 HTMLCanvasElement，width 可赋值

const MOCK_PAGES = Array.from({ length: 8 }, (_, i) => ({
  pageNum: i + 1,
  naturalWidth: 595,
  naturalHeight: 842,
  imageUrl: `mock://page-${i + 1}.png`,
}))

function makePool(maxPoolSize = 5) {
  return new VirtualPagePool({ maxPoolSize })
}

describe('VirtualPagePool', () => {
  let pool: VirtualPagePool

  beforeEach(() => {
    pool = makePool(3)  // maxPoolSize=3 方便测试 LRU
    pool.init(MOCK_PAGES.slice(0, 5))
  })

  test('init 后所有页状态为 unloaded', () => {
    const status = pool.getPoolStatus()
    expect(status.size).toBe(0)
    expect(status.pages.every(p => p.status === 'unloaded')).toBe(true)
  })

  test('preload(1) 后第 1 页状态变为 rendered，canvas 不为 null', async () => {
    await pool.preload(1)
    const canvas = pool.getCanvas(1)
    expect(canvas).not.toBeNull()
    const status = pool.getPoolStatus()
    expect(status.size).toBe(1)
    expect(status.pages.find(p => p.pageNum === 1)?.status).toBe('rendered')
  })

  test('preload(1) 更新 lastAccessTime', async () => {
    const before = Date.now()
    await pool.preload(1)
    const page = pool.getPoolStatus().pages.find(p => p.pageNum === 1)!
    expect(page.lastAccessTime).toBeGreaterThanOrEqual(before)
  })

  test('超过 maxPoolSize(3) 时自动触发 LRU 淘汰', async () => {
    await pool.preload(1)
    await pool.preload(2)
    await pool.preload(3)
    // 加第 4 页应淘汰第 1 页（最早访问）
    await pool.preload(4)
    const status = pool.getPoolStatus()
    expect(status.size).toBe(3)  // 始终 ≤ maxPoolSize
  })

  test('LRU 淘汰最旧访问时间的页（lastAccessTime 最小）', async () => {
    await pool.preload(1)
    await new Promise(r => setTimeout(r, 5))
    await pool.preload(2)
    await new Promise(r => setTimeout(r, 5))
    await pool.preload(3)
    // pool 满：1(oldest), 2, 3(newest)
    // 加第 4 页 → 淘汰第 1 页
    await pool.preload(4)
    const p1 = pool.getPoolStatus().pages.find(p => p.pageNum === 1)!
    expect(p1.status).toBe('evicted')
  })

  test('淘汰后目标页 canvas.width === 0', async () => {
    await pool.preload(1)
    await pool.preload(2)
    await pool.preload(3)
    const canvasP1Before = pool.getCanvas(1)!
    await pool.preload(4)
    // p1 被淘汰，canvas 应被 width=0 置为释放状态
    expect(canvasP1Before.width).toBe(0)
  })

  test('getCanvas() 访问已淘汰页返回 null', async () => {
    await pool.preload(1)
    await pool.preload(2)
    await pool.preload(3)
    await pool.preload(4)  // p1 被淘汰
    expect(pool.getCanvas(1)).toBeNull()
  })

  test('onPoolSizeChange 在 load 时触发', async () => {
    const fn = vi.fn()
    pool = makePool(3)
    pool.init(MOCK_PAGES.slice(0, 5))
    pool.onPoolSizeChange(fn)
    await pool.preload(1)
    expect(fn).toHaveBeenCalledWith(1, 3)
  })

  test('onPoolSizeChange 在 evict 时触发（size 减少）', async () => {
    const fn = vi.fn()
    pool = makePool(2)
    pool.init(MOCK_PAGES.slice(0, 5))
    pool.onPoolSizeChange(fn)
    await pool.preload(1)
    await pool.preload(2)
    // pool 满（maxSize=2），加第 3 页触发淘汰
    fn.mockClear()
    await pool.preload(3)
    // 先 evict（size 1），再 load（size 2）
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('destroy 清空所有 canvas', async () => {
    await pool.preload(1)
    await pool.preload(2)
    pool.destroy()
    expect(pool.getPoolStatus().size).toBe(0)
  })
})
