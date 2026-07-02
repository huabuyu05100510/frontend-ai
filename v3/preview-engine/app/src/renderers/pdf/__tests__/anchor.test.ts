import { describe, it, expect } from 'vitest'
import { toScreen, toPdf, rotateRectNorm } from '../anchor'
import type { PdfRect, Viewport } from '../anchor'

const vp = (width: number, height: number, rotation: 0 | 90 | 180 | 270 = 0): Viewport => ({
  width,
  height,
  scale: 1,
  rotation,
})

describe('toScreen（归一化 PDF 矩形 → 屏幕 px）', () => {
  it('rotation 0 直接按比例', () => {
    const r: PdfRect = { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    expect(toScreen(r, vp(1000, 500))).toEqual({ x: 100, y: 100, w: 300, h: 200 })
  })

  it('缩放无关：视口放大一倍，屏幕坐标等比放大', () => {
    const r: PdfRect = { page: 0, x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    const s1 = toScreen(r, vp(800, 800))
    const s2 = toScreen(r, vp(1600, 1600))
    expect(s2.x).toBe(s1.x * 2)
    expect(s2.w).toBe(s1.w * 2)
  })
})

describe('toPdf（屏幕 px → 归一化 PDF 矩形）', () => {
  it('rotation 0 还原', () => {
    const r = toPdf({ x: 100, y: 100, w: 300, h: 200 }, vp(1000, 500), 0)
    expect(r.x).toBeCloseTo(0.1)
    expect(r.y).toBeCloseTo(0.2)
    expect(r.w).toBeCloseTo(0.3)
    expect(r.h).toBeCloseTo(0.4)
    expect(r.page).toBe(0)
  })

  it('缩放无关：不同视口尺寸还原出相同归一化坐标', () => {
    const a = toPdf({ x: 200, y: 200, w: 400, h: 400 }, vp(800, 800), 0)
    const b = toPdf({ x: 400, y: 400, w: 800, h: 800 }, vp(1600, 1600), 0)
    expect(a.x).toBeCloseTo(b.x)
    expect(a.w).toBeCloseTo(b.w)
  })
})

describe('toScreen ↔ toPdf 往返一致（含旋转）', () => {
  const cases: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270]
  for (const rot of cases) {
    it(`rotation ${rot} 往返还原`, () => {
      const r: PdfRect = { page: 2, x: 0.15, y: 0.25, w: 0.3, h: 0.2 }
      const screen = toScreen(r, vp(1000, 700, rot))
      const back = toPdf(screen, vp(1000, 700, rot), 2)
      expect(back.x).toBeCloseTo(r.x, 5)
      expect(back.y).toBeCloseTo(r.y, 5)
      expect(back.w).toBeCloseTo(r.w, 5)
      expect(back.h).toBeCloseTo(r.h, 5)
      expect(back.page).toBe(2)
    })
  }
})

describe('rotateRectNorm（归一化矩形旋转）', () => {
  it('0 度不变', () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    expect(rotateRectNorm(r, 0)).toEqual(r)
  })

  it('180 度对称', () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    const out = rotateRectNorm(r, 180)
    expect(out.x).toBeCloseTo(1 - 0.1 - 0.3)
    expect(out.y).toBeCloseTo(1 - 0.2 - 0.4)
    expect(out.w).toBeCloseTo(0.3)
    expect(out.h).toBeCloseTo(0.4)
  })

  it('90 度宽高互换', () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    const out = rotateRectNorm(r, 90)
    expect(out.w).toBeCloseTo(0.4)
    expect(out.h).toBeCloseTo(0.3)
  })

  it('旋转 90 四次回到原位', () => {
    let r = { x: 0.12, y: 0.34, w: 0.2, h: 0.15 }
    const orig = { ...r }
    for (let i = 0; i < 4; i++) r = rotateRectNorm(r, 90)
    expect(r.x).toBeCloseTo(orig.x, 5)
    expect(r.y).toBeCloseTo(orig.y, 5)
    expect(r.w).toBeCloseTo(orig.w, 5)
    expect(r.h).toBeCloseTo(orig.h, 5)
  })
})
