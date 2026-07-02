import { describe, it, expect } from 'vitest'
import { CumulativeIndex } from '../CumulativeIndex'

describe('CumulativeIndex（累计高度 + 二分定位）', () => {
  it('等高单元：offset 与可见区间正确', () => {
    const idx = new CumulativeIndex(10, () => 100) // 10 个单元，每个高 100
    expect(idx.totalSize()).toBe(1000)
    expect(idx.offsetOf(0)).toBe(0)
    expect(idx.offsetOf(3)).toBe(300)
    // 视口 [250, 550] → 覆盖单元 2,3,4,5
    expect(idx.rangeForViewport(250, 300)).toEqual({ start: 2, end: 5 })
  })

  it('变高单元：累计偏移正确', () => {
    const sizes = [50, 150, 200, 100]
    const idx = new CumulativeIndex(sizes.length, (i) => sizes[i])
    expect(idx.totalSize()).toBe(500)
    expect(idx.offsetOf(0)).toBe(0)
    expect(idx.offsetOf(1)).toBe(50)
    expect(idx.offsetOf(2)).toBe(200)
    expect(idx.offsetOf(3)).toBe(400)
    expect(idx.indexAt(60)).toBe(1) // 60 落在单元 1（[50,200)）
    expect(idx.indexAt(400)).toBe(3)
  })

  it('百万单元定位是 O(log n)，结果正确且快速', () => {
    const n = 1_000_000
    const idx = new CumulativeIndex(n, () => 20) // 百万行，每行 20px
    expect(idx.totalSize()).toBe(20_000_000)
    const t0 = performance.now()
    const r = idx.rangeForViewport(9_999_980, 400) // 第 ~50 万行附近
    const dt = performance.now() - t0
    expect(r.start).toBe(499999)
    expect(r.end).toBe(500018)
    expect(dt).toBeLessThan(5) // 远快于线性扫描
  })

  it('视口超出末尾时夹紧到最后一个单元', () => {
    const idx = new CumulativeIndex(5, () => 100)
    expect(idx.rangeForViewport(900, 500)).toEqual({ start: 4, end: 4 })
  })

  it('scrollTop=0 从首单元开始', () => {
    const idx = new CumulativeIndex(5, () => 100)
    expect(idx.rangeForViewport(0, 100)).toEqual({ start: 0, end: 0 })
  })

  it('空集合不抛异常', () => {
    const idx = new CumulativeIndex(0, () => 100)
    expect(idx.totalSize()).toBe(0)
    expect(idx.rangeForViewport(0, 100)).toEqual({ start: 0, end: -1 })
  })

  it('支持更新单个单元尺寸后重算（懒重建）', () => {
    const idx = new CumulativeIndex(3, () => 100)
    idx.setSize(0, 300)
    expect(idx.totalSize()).toBe(500)
    expect(idx.offsetOf(1)).toBe(300)
    expect(idx.offsetOf(2)).toBe(400)
  })
})
