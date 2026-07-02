import { describe, it, expect } from 'vitest'
import { fitScale, clampScale } from '../fit'

describe('fitScale（适配视口的等比缩放）', () => {
  it('宽受限：图比视口宽', () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5)
  })

  it('高受限：图比视口高', () => {
    expect(fitScale({ width: 1000, height: 4000 }, { width: 1000, height: 1000 })).toBe(0.25)
  })

  it('图比视口小 → 不放大（scale ≤ 1）', () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(1)
  })

  it('取宽高比中较小者（保证完整可见）', () => {
    // 宽比 0.5，高比 0.8 → 取 0.5
    expect(fitScale({ width: 2000, height: 1250 }, { width: 1000, height: 1000 })).toBe(0.5)
  })

  it('零尺寸不崩（返回 1）', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 1000, height: 1000 })).toBe(1)
  })
})

describe('clampScale（缩放钳制）', () => {
  it('钳到上限', () => {
    expect(clampScale(10, 0.1, 8)).toBe(8)
  })
  it('钳到下限', () => {
    expect(clampScale(0.01, 0.1, 8)).toBe(0.1)
  })
  it('区间内保持', () => {
    expect(clampScale(2, 0.1, 8)).toBe(2)
  })
})
