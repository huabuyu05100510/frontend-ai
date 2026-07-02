import { describe, it, expect } from 'vitest'
import { createAnnotation, pointInRect, hitTest, inkBounds } from '../AnnotationModel'
import type { Annotation } from '../AnnotationModel'

describe('createAnnotation', () => {
  it('创建高亮，带 id/author/createdAt', () => {
    const a = createAnnotation(
      { type: 'highlight', rect: { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, color: '#ff0' },
      { author: 'Alice', now: 123 },
    )
    expect(a.type).toBe('highlight')
    expect(a.author).toBe('Alice')
    expect(a.createdAt).toBe(123)
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
  })

  it('id 唯一', () => {
    const mk = () =>
      createAnnotation({ type: 'rect', rect: { page: 0, x: 0, y: 0, w: 0.1, h: 0.1 }, color: '#f00' }, { author: 'A' })
    expect(mk().id).not.toBe(mk().id)
  })
})

describe('pointInRect（归一化点命中）', () => {
  const rect = { page: 1, x: 0.2, y: 0.2, w: 0.3, h: 0.3 }
  it('内部命中', () => {
    expect(pointInRect(0.3, 0.3, rect)).toBe(true)
  })
  it('边界外不命中', () => {
    expect(pointInRect(0.6, 0.3, rect)).toBe(false)
    expect(pointInRect(0.1, 0.3, rect)).toBe(false)
  })
})

describe('hitTest（取最上层注解）', () => {
  const base = (x: number): Annotation =>
    createAnnotation({ type: 'rect', rect: { page: 0, x, y: 0.1, w: 0.4, h: 0.4 }, color: '#f00' }, { author: 'A' })

  it('命中重叠注解时返回最后绘制（最上层）', () => {
    const a = base(0.1)
    const b = base(0.2) // 与 a 重叠于 (0.2~0.5)
    const hit = hitTest([a, b], 0, 0.3, 0.2)
    expect(hit?.id).toBe(b.id) // 后绘制者在上
  })

  it('不同页不命中', () => {
    const a = base(0.1)
    expect(hitTest([a], 1, 0.2, 0.2)).toBeNull()
  })

  it('空命中返回 null', () => {
    expect(hitTest([], 0, 0.5, 0.5)).toBeNull()
  })

  it('ink 注解按包围盒命中', () => {
    const ink = createAnnotation(
      { type: 'ink', page: 0, points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }], color: '#0f0', width: 2 },
      { author: 'A' },
    )
    expect(hitTest([ink], 0, 0.2, 0.2)).toBe(ink)
    expect(hitTest([ink], 0, 0.9, 0.9)).toBeNull()
  })
})

describe('inkBounds（手绘包围盒）', () => {
  it('计算 min/max 包围盒', () => {
    const b = inkBounds([
      { x: 0.2, y: 0.5 },
      { x: 0.4, y: 0.1 },
      { x: 0.3, y: 0.8 },
    ])
    expect(b.x).toBeCloseTo(0.2)
    expect(b.y).toBeCloseTo(0.1)
    expect(b.w).toBeCloseTo(0.2)
    expect(b.h).toBeCloseTo(0.7)
  })

  it('单点包围盒为零面积', () => {
    const b = inkBounds([{ x: 0.5, y: 0.5 }])
    expect(b.w).toBe(0)
    expect(b.h).toBe(0)
  })

  it('空点集返回零矩形', () => {
    expect(inkBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})
