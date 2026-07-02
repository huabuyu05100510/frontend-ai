/**
 * @skeleton/adapter-rn - React Native 适配器单元测试
 *
 * 测试纯逻辑函数（不依赖真实 RN 运行时）：
 * - measureView：Promise 化 View.measure()
 * - extractRNStyles：RN 样式归一化
 * - buildMeasurementTree：节点树构建
 */

import { describe, it, expect, vi } from 'vitest'
import { measureView, extractRNStyles, buildMeasurementTree } from '../adapter.js'

// ─── measureView 测试 ─────────────────────────────────────────────────────────

describe('measureView', () => {
  it('Promise 化回调，正确返回 MeasureResult', async () => {
    const mockRef = {
      measure: vi.fn((cb) => {
        cb(0, 0, 200, 100, 50, 80)  // x, y, width, height, pageX, pageY
      }),
    }

    const result = await measureView(mockRef)
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
    expect(result.pageX).toBe(50)
    expect(result.pageY).toBe(80)
  })

  it('measure 抛出异常时 reject', async () => {
    const mockRef = {
      measure: vi.fn(() => {
        throw new Error('ref not attached')
      }),
    }

    await expect(measureView(mockRef)).rejects.toThrow('ref not attached')
  })
})

// ─── extractRNStyles 测试 ────────────────────────────────────────────────────

describe('extractRNStyles', () => {
  const rootRect = { left: 0, top: 0, width: 375, height: 200 }

  it('透明背景正确', () => {
    const styles = extractRNStyles({}, { left: 0, top: 0, width: 100, height: 50 }, rootRect)
    expect(styles.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('backgroundColor 正确提取', () => {
    const styles = extractRNStyles(
      { backgroundColor: '#f0f0f0' },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.backgroundColor).toBe('#f0f0f0')
  })

  it('borderRadius 正确提取', () => {
    const styles = extractRNStyles(
      { borderRadius: 8 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.borderRadius).toBe('8px')
  })

  it('hasBorder：borderWidth > 0', () => {
    const styles = extractRNStyles(
      { borderWidth: 2 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.hasBorder).toBe(true)
  })

  it('hasBorder：borderWidth === 0', () => {
    const styles = extractRNStyles(
      { borderWidth: 0 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.hasBorder).toBe(false)
  })

  it('flexShrink=0 时 isFixedWidth=true', () => {
    const styles = extractRNStyles(
      { flexShrink: 0 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.isFixedWidth).toBe(true)
  })

  it('数字 width < 父宽 40% 时 isFixedWidth=true', () => {
    // 375 * 0.4 = 150，width=100 < 150 → fixed
    const styles = extractRNStyles(
      { width: 100 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.isFixedWidth).toBe(true)
  })

  it('数字 width >= 父宽 40% 时 isFixedWidth=false', () => {
    // 375 * 0.4 = 150，width=200 > 150 → not fixed
    const styles = extractRNStyles(
      { width: 200 },
      { left: 0, top: 0, width: 200, height: 50 },
      rootRect,
    )
    expect(styles.isFixedWidth).toBe(false)
  })

  it('string width（如 "100%"）不触发 isFixedWidth', () => {
    const styles = extractRNStyles(
      { width: '100%' },
      { left: 0, top: 0, width: 375, height: 50 },
      rootRect,
    )
    expect(styles.isFixedWidth).toBe(false)
  })

  it('minWidth / maxWidth 正确提取', () => {
    const styles = extractRNStyles(
      { minWidth: 80, maxWidth: 200 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.minWidth).toBe(80)
    expect(styles.maxWidth).toBe(200)
  })

  it('opacity 字符串化', () => {
    const styles = extractRNStyles(
      { opacity: 0.5 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
    )
    expect(styles.opacity).toBe('0.5')
  })
})

// ─── buildMeasurementTree 测试 ────────────────────────────────────────────────

describe('buildMeasurementTree', () => {
  const rootRect = { left: 0, top: 0, width: 375, height: 200 }

  it('单节点正确构建', async () => {
    const nodes = [{
      tag: 'View',
      ref: {
        measure: vi.fn((cb) => cb(0, 0, 200, 80, 10, 20)),
      },
      style: { backgroundColor: '#fff' },
      isLeaf: false,
      children: [],
    }]

    const result = await buildMeasurementTree(nodes, rootRect)
    expect(result).toHaveLength(1)
    expect(result[0].tag).toBe('View')
    expect(result[0].rect.width).toBe(200)
    expect(result[0].rect.pageX).toBeUndefined()  // Rect 不含 pageX
    expect(result[0].rect.left).toBe(10)  // pageX → left
  })

  it('measure 失败节点被跳过', async () => {
    const nodes = [
      {
        tag: 'View',
        ref: { measure: vi.fn(() => { throw new Error('failed') }) },
        style: {},
        isLeaf: false,
        children: [],
      },
      {
        tag: 'Text',
        ref: { measure: vi.fn((cb) => cb(0, 0, 100, 20, 5, 10)) },
        style: {},
        isLeaf: true,
        children: [],
      },
    ]

    const result = await buildMeasurementTree(nodes, rootRect)
    expect(result).toHaveLength(1)  // 第一个失败，只有第二个
    expect(result[0].tag).toBe('Text')
  })

  it('isLeaf 叶节点不递归', async () => {
    const innerChild = {
      tag: 'Image',
      ref: { measure: vi.fn((cb) => cb(0, 0, 50, 50, 5, 5)) },
      style: {},
      isLeaf: true,
      children: [],
    }

    const nodes = [{
      tag: 'View',
      ref: { measure: vi.fn((cb) => cb(0, 0, 200, 80, 0, 0)) },
      style: {},
      isLeaf: false,
      children: [innerChild],
    }]

    const result = await buildMeasurementTree(nodes, rootRect)
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children[0].tag).toBe('Image')
  })
})
