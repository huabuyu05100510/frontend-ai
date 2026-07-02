import { describe, it, expect } from 'vitest'
import { buildDrawOps } from '../exportOps'
import { createAnnotation } from '../AnnotationModel'

// pdf-lib 坐标系原点在左下；我们的归一化原点在左上。
// buildDrawOps 输出 PDF 点坐标（左下原点），用页面尺寸换算。
const pageSizes = [
  { width: 600, height: 800 },
  { width: 1000, height: 500 },
]

describe('buildDrawOps（注解 → 与库无关的绘制描述符）', () => {
  it('highlight → 半透明填充矩形，坐标转换到左下原点', () => {
    const a = createAnnotation(
      { type: 'highlight', rect: { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, color: '#ffff00' },
      { author: 'A' },
    )
    const ops = buildDrawOps([a], pageSizes)
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.page).toBe(0)
    expect(op.kind).toBe('rect')
    if (op.kind === 'rect') {
      expect(op.fill).toBe(true)
      expect(op.opacity).toBeLessThan(1) // 高亮半透明
      expect(op.x).toBeCloseTo(0.1 * 600)
      expect(op.w).toBeCloseTo(0.2 * 600)
      // y 翻转：top-left y=0.1,h=0.05 → bottom-left y = (1 - 0.1 - 0.05)*800
      expect(op.y).toBeCloseTo((1 - 0.1 - 0.05) * 800)
      expect(op.h).toBeCloseTo(0.05 * 800)
    }
  })

  it('rect → 描边矩形（不填充）', () => {
    const a = createAnnotation(
      { type: 'rect', rect: { page: 1, x: 0, y: 0, w: 0.5, h: 0.5 }, color: '#ff0000' },
      { author: 'A' },
    )
    const ops = buildDrawOps([a], pageSizes)
    expect(ops[0].kind).toBe('rect')
    if (ops[0].kind === 'rect') {
      expect(ops[0].fill).toBe(false)
      expect(ops[0].stroke).toBe(true)
    }
  })

  it('redact → 实心黑块（不透明）', () => {
    const a = createAnnotation({ type: 'redact', rect: { page: 0, x: 0.2, y: 0.2, w: 0.3, h: 0.1 } }, { author: 'A' })
    const ops = buildDrawOps([a], pageSizes)
    expect(ops[0].kind).toBe('rect')
    if (ops[0].kind === 'rect') {
      expect(ops[0].fill).toBe(true)
      expect(ops[0].opacity).toBe(1)
      expect(ops[0].color).toEqual({ r: 0, g: 0, b: 0 })
    }
  })

  it('ink → 折线，点坐标 y 翻转', () => {
    const a = createAnnotation(
      { type: 'ink', page: 0, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], color: '#00ff00', width: 3 },
      { author: 'A' },
    )
    const ops = buildDrawOps([a], pageSizes)
    expect(ops[0].kind).toBe('polyline')
    if (ops[0].kind === 'polyline') {
      expect(ops[0].points[0].x).toBeCloseTo(0.1 * 600)
      expect(ops[0].points[0].y).toBeCloseTo((1 - 0.2) * 800)
      expect(ops[0].width).toBe(3)
    }
  })

  it('note → 文本绘制', () => {
    const a = createAnnotation(
      { type: 'note', rect: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, text: '审阅意见' },
      { author: 'A' },
    )
    const ops = buildDrawOps([a], pageSizes)
    expect(ops[0].kind).toBe('text')
    if (ops[0].kind === 'text') {
      expect(ops[0].text).toBe('审阅意见')
    }
  })

  it('十六进制颜色解析为 0~1 RGB', () => {
    const a = createAnnotation(
      { type: 'rect', rect: { page: 0, x: 0, y: 0, w: 0.1, h: 0.1 }, color: '#3399ff' },
      { author: 'A' },
    )
    const op = buildDrawOps([a], pageSizes)[0]
    if (op.kind === 'rect') {
      expect(op.color.r).toBeCloseTo(0x33 / 255)
      expect(op.color.g).toBeCloseTo(0x99 / 255)
      expect(op.color.b).toBeCloseTo(0xff / 255)
    }
  })

  it('空注解 → 空描述符', () => {
    expect(buildDrawOps([], pageSizes)).toEqual([])
  })

  it('忽略越界页索引的注解', () => {
    const a = createAnnotation(
      { type: 'rect', rect: { page: 99, x: 0, y: 0, w: 0.1, h: 0.1 }, color: '#000' },
      { author: 'A' },
    )
    expect(buildDrawOps([a], pageSizes)).toEqual([])
  })
})
