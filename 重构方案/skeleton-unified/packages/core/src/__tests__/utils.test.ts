import { describe, it, expect } from 'vitest'
import {
  toPercent, round2, rectToPercent, parseRadius,
  adjustColor, isTransparent, resolveBreakpoint, fnv1a32,
} from '../utils.js'

describe('toPercent', () => {
  it('基本转换', () => {
    expect(toPercent(37.5, 375)).toBe(10)
    expect(toPercent(375, 375)).toBe(100)
    expect(toPercent(0, 375)).toBe(0)
  })

  it('base 为 0 时返回 0', () => {
    expect(toPercent(100, 0)).toBe(0)
  })

  it('保留 2 位小数', () => {
    expect(toPercent(100, 375)).toBe(26.67)
  })
})

describe('round2', () => {
  it('正常值', () => {
    expect(round2(1.234)).toBe(1.23)
    expect(round2(1.235)).toBe(1.24)
    expect(round2(100)).toBe(100)
  })

  it('NaN / Infinity 归 0', () => {
    expect(round2(NaN)).toBe(0)
    expect(round2(Infinity)).toBe(0)
    expect(round2(-Infinity)).toBe(0)
  })
})

describe('rectToPercent', () => {
  it('完整转换', () => {
    const rootRect = { left: 0, top: 100, width: 375, height: 250 }
    const rect = { left: 10, top: 120, width: 100, height: 50 }
    const result = rectToPercent(rect, rootRect)
    expect(result.x).toBe(round2(10 / 375 * 100))
    expect(result.y).toBe(round2(20 / 250 * 100))
    expect(result.w).toBe(round2(100 / 375 * 100))
    expect(result.h).toBe(round2(50 / 250 * 100))
  })

  it('子节点与根 left 对齐时 x=0', () => {
    const rootRect = { left: 50, top: 50, width: 300, height: 200 }
    const rect = { left: 50, top: 50, width: 300, height: 200 }
    const result = rectToPercent(rect, rootRect)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
    expect(result.w).toBe(100)
    expect(result.h).toBe(100)
  })
})

describe('parseRadius', () => {
  it('无圆角返回 undefined', () => {
    expect(parseRadius('0px')).toBeUndefined()
    expect(parseRadius('')).toBeUndefined()
    expect(parseRadius('none')).toBeUndefined()
  })

  it('50% 返回 "50%"', () => {
    expect(parseRadius('50%')).toBe('50%')
  })

  it('均匀圆角返回数值', () => {
    expect(parseRadius('8px')).toBe(8)
    expect(parseRadius('8px 8px 8px 8px')).toBe(8)
  })

  it('超大圆角正方形 → "50%"', () => {
    expect(parseRadius('9999px', { width: 40, height: 40 })).toBe('50%')
  })

  it('超大圆角矩形 → 9999', () => {
    expect(parseRadius('9999px', { width: 200, height: 40 })).toBe(9999)
    expect(parseRadius('9999px')).toBe(9999) // 无 rect 时默认胶囊
  })

  it('不对称四角 → CSS 字符串', () => {
    expect(parseRadius('8px 4px 2px 0px')).toBe('8px 4px 2px 0px')
  })
})

describe('adjustColor', () => {
  it('十六进制变亮', () => {
    const result = adjustColor('#f0f0f0', 0.3)
    // 每通道 240 + (255-240)*0.3 = 244.5 → Math.round(244.5) = 245 = #f5
    expect(result).toBe('#f5f5f5')
  })

  it('rgba 调整 alpha', () => {
    const result = adjustColor('rgba(100,100,100,0.5)', 0.3)
    expect(result).toContain('rgba(100,100,100,')
    // alpha 应变大
    const alpha = parseFloat(result.match(/[\d.]+\)/)![0])
    expect(alpha).toBeGreaterThan(0.5)
  })

  it('不支持的格式原样返回', () => {
    expect(adjustColor('hsl(0,100%,50%)', 0.3)).toBe('hsl(0,100%,50%)')
  })
})

describe('isTransparent', () => {
  it('透明颜色', () => {
    expect(isTransparent('rgba(0, 0, 0, 0)')).toBe(true)
    expect(isTransparent('transparent')).toBe(true)
    expect(isTransparent('')).toBe(true)
  })

  it('不透明颜色', () => {
    expect(isTransparent('#f0f0f0')).toBe(false)
    expect(isTransparent('rgba(255,255,255,1)')).toBe(false)
    expect(isTransparent('white')).toBe(false)
  })
})

describe('resolveBreakpoint', () => {
  const bps = { 375: 'mobile', 768: 'tablet', 1280: 'desktop' }

  it('精确匹配', () => {
    expect(resolveBreakpoint(bps, 375)).toBe('mobile')
    expect(resolveBreakpoint(bps, 768)).toBe('tablet')
  })

  it('取最接近的下界', () => {
    expect(resolveBreakpoint(bps, 500)).toBe('mobile')
    expect(resolveBreakpoint(bps, 800)).toBe('tablet')
    expect(resolveBreakpoint(bps, 1920)).toBe('desktop')
  })

  it('小于最小断点时取最小断点', () => {
    expect(resolveBreakpoint(bps, 320)).toBe('mobile')
  })

  it('空断点返回 null', () => {
    expect(resolveBreakpoint({}, 375)).toBeNull()
  })
})

describe('fnv1a32', () => {
  it('相同输入产生相同哈希', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'))
  })

  it('不同输入产生不同哈希', () => {
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'))
  })

  it('返回 8 字符十六进制字符串', () => {
    const h = fnv1a32('test')
    expect(h).toMatch(/^[0-9a-f]{8}$/)
  })
})
