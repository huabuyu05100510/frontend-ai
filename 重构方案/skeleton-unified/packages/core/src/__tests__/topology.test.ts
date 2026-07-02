import { describe, it, expect } from 'vitest'
import { isRedundantWrapper, collapseRedundantWrappers } from '../topology.js'
import type { NodeMeasurement, Rect, NodeStyles } from '../types.js'

// ─── 测试辅助 ─────────────────────────────────────────────────────────────────

function makeStyles(overrides: Partial<NodeStyles> = {}): NodeStyles {
  return {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    overflow: 'visible',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    borderRadius: '0',
    hasBorder: false,
    isFixedWidth: false,
    isFixedHeight: false,
    minWidth: 0,
    maxWidth: Infinity,
    minHeight: 0,
    maxHeight: Infinity,
    boxShadow: 'none',
    ...overrides,
  }
}

function makeRect(l = 0, t = 0, w = 375, h = 200): Rect {
  return { left: l, top: t, width: w, height: h }
}

function makeNode(
  id: string,
  tag: string,
  rect: Rect,
  stylesOverrides: Partial<NodeStyles> = {},
  children: NodeMeasurement[] = [],
  isLeaf = false,
): NodeMeasurement {
  return {
    id,
    tag,
    rect,
    styles: makeStyles(stylesOverrides),
    children,
    isLeaf,
  }
}

// ─── isRedundantWrapper ───────────────────────────────────────────────────────

describe('isRedundantWrapper', () => {
  const parentRect = makeRect(0, 0, 375, 200)

  it('rect 完全重合 + 无视觉样式 → 冗余', () => {
    const node = makeNode('n1', 'div', makeRect(0, 0, 375, 200))
    expect(isRedundantWrapper(node, parentRect)).toBe(true)
  })

  it('rect 不重合 → 非冗余', () => {
    const node = makeNode('n1', 'div', makeRect(10, 10, 355, 180))
    expect(isRedundantWrapper(node, parentRect)).toBe(false)
  })

  it('有背景色 → 非冗余', () => {
    const node = makeNode('n1', 'div', makeRect(0, 0, 375, 200), {
      backgroundColor: '#ffffff',
    })
    expect(isRedundantWrapper(node, parentRect)).toBe(false)
  })

  it('有边框 → 非冗余', () => {
    const node = makeNode('n1', 'div', makeRect(0, 0, 375, 200), {
      hasBorder: true,
      borderRadius: '8px',
    })
    expect(isRedundantWrapper(node, parentRect)).toBe(false)
  })

  it('有阴影 → 非冗余', () => {
    const node = makeNode('n1', 'div', makeRect(0, 0, 375, 200), {
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    })
    expect(isRedundantWrapper(node, parentRect)).toBe(false)
  })

  it('叶节点 → 非冗余', () => {
    const node = makeNode('n1', 'p', makeRect(0, 0, 375, 200), {}, [], true)
    expect(isRedundantWrapper(node, parentRect)).toBe(false)
  })

  it('语义节点 table → 非冗余', () => {
    const node = makeNode('n1', 'table', makeRect(0, 0, 375, 200))
    expect(isRedundantWrapper(node, parentRect)).toBe(false)
  })

  it('1px 容差内仍是冗余', () => {
    // 1px 偏差（subpixel 渲染）
    const node = makeNode('n1', 'div', makeRect(0, 0.5, 375, 200))
    expect(isRedundantWrapper(node, parentRect)).toBe(true)
  })
})

// ─── collapseRedundantWrappers ────────────────────────────────────────────────

describe('collapseRedundantWrappers', () => {
  it('无冗余包装层时原样返回', () => {
    const leaf = makeNode('leaf', 'p', makeRect(10, 10, 300, 20), {}, [], true)
    const root = makeNode('root', 'div', makeRect(0, 0, 375, 200), {}, [leaf])
    const result = collapseRedundantWrappers(root)
    expect(result.children).toHaveLength(1)
    expect(result.children[0].id).toBe('leaf')
  })

  it('单层冗余包装层被压缩，子节点提升', () => {
    const leaf = makeNode('leaf', 'p', makeRect(10, 10, 300, 20), {}, [], true)
    // redundant: 与 root 完全重合，无视觉样式
    const wrapper = makeNode('wrapper', 'div', makeRect(0, 0, 375, 200), {}, [leaf])
    const root = makeNode('root', 'div', makeRect(0, 0, 375, 200), {}, [wrapper])

    const result = collapseRedundantWrappers(root)
    expect(result.children).toHaveLength(1)
    expect(result.children[0].id).toBe('leaf')
  })

  it('链式冗余包装层全部压缩', () => {
    const leaf = makeNode('leaf', 'p', makeRect(10, 10, 300, 20), {}, [], true)
    const w2 = makeNode('w2', 'div', makeRect(0, 0, 375, 200), {}, [leaf])
    const w1 = makeNode('w1', 'div', makeRect(0, 0, 375, 200), {}, [w2])
    const root = makeNode('root', 'div', makeRect(0, 0, 375, 200), {}, [w1])

    const result = collapseRedundantWrappers(root)
    expect(result.children).toHaveLength(1)
    expect(result.children[0].id).toBe('leaf')
  })

  it('非冗余层保留，其内部冗余层被压缩', () => {
    const leaf = makeNode('leaf', 'p', makeRect(10, 10, 300, 20), {}, [], true)
    const redundant = makeNode('red', 'div', makeRect(20, 20, 200, 100), {}, [leaf])
    // card: 有背景，非冗余
    const card = makeNode('card', 'div', makeRect(20, 20, 200, 100), {
      backgroundColor: '#fff',
    }, [redundant])
    const root = makeNode('root', 'div', makeRect(0, 0, 375, 200), {}, [card])

    const result = collapseRedundantWrappers(root)
    expect(result.children).toHaveLength(1)
    expect(result.children[0].id).toBe('card')
    // card 内的冗余层被压缩，leaf 提升
    expect(result.children[0].children).toHaveLength(1)
    expect(result.children[0].children[0].id).toBe('leaf')
  })

  it('统计信息正确', () => {
    const leaf = makeNode('leaf', 'p', makeRect(10, 10, 300, 20), {}, [], true)
    const wrapper = makeNode('wrapper', 'div', makeRect(0, 0, 375, 200), {}, [leaf])
    const root = makeNode('root', 'div', makeRect(0, 0, 375, 200), {}, [wrapper])

    const stats = { originalCount: 0, prunedCount: 0, finalCount: 0 }
    collapseRedundantWrappers(root, stats)
    expect(stats.prunedCount).toBe(1)
    expect(stats.originalCount).toBeGreaterThan(0)
  })
})
