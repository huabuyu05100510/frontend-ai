/**
 * @skeleton/adapter-taro - Taro 适配器单元测试
 *
 * 仅测试纯逻辑函数（不依赖 @tarojs/taro 运行时）：
 * - buildMPNode：小程序节点构建逻辑
 * - createTaroAdapter：适配器接口结构
 */

import { describe, it, expect } from 'vitest'
import { buildMPNode } from '../adapter.js'

// ─── buildMPNode 测试 ─────────────────────────────────────────────────────────

describe('buildMPNode - 节点构建', () => {
  const rootRect = { left: 0, top: 0, width: 375, height: 200 }

  it('基本节点结构正确', () => {
    const node = buildMPNode(
      {
        left: 10, top: 20, width: 100, height: 50,
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        borderWidth: '0',
        opacity: '1',
        overflow: 'hidden',
        dataset: { skeTag: 'view' },
      },
      { left: 10, top: 20, width: 100, height: 50 },
      rootRect,
      'mp-0',
    )

    expect(node.id).toBe('mp-0')
    expect(node.tag).toBe('view')
    expect(node.rect.width).toBe(100)
    expect(node.rect.height).toBe(50)
    expect(node.styles.backgroundColor).toBe('#ffffff')
    expect(node.styles.borderRadius).toBe('8px')
    expect(node.isLeaf).toBe(false)
    expect(node.children).toHaveLength(0)  // 小程序平铺结构，无递归子节点
  })

  it('原子叶节点标签正确识别', () => {
    const leafTags = ['image', 'text', 'button', 'input', 'video', 'canvas']
    for (const tag of leafTags) {
      const node = buildMPNode(
        {
          left: 0, top: 0, width: 50, height: 50,
          dataset: { skeTag: tag },
        },
        { left: 0, top: 0, width: 50, height: 50 },
        rootRect,
        `mp-${tag}`,
      )
      expect(node.isLeaf, `${tag} should be leaf`).toBe(true)
    }
  })

  it('data-ske-leaf="1" 强制为叶节点', () => {
    const node = buildMPNode(
      {
        left: 0, top: 0, width: 100, height: 50,
        dataset: { skeTag: 'view', skeLeaf: '1' },
      },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
      'mp-leaf',
    )
    expect(node.isLeaf).toBe(true)
  })

  it('无 dataset 时 tag 默认为 view', () => {
    const node = buildMPNode(
      { left: 0, top: 0, width: 100, height: 50 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect,
      'mp-default',
    )
    expect(node.tag).toBe('view')
  })

  it('hasBorder 检测', () => {
    const withBorder = buildMPNode(
      { left: 0, top: 0, width: 100, height: 50, borderWidth: '2px' },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect, 'mp-border',
    )
    expect(withBorder.styles.hasBorder).toBe(true)

    const noBorder = buildMPNode(
      { left: 0, top: 0, width: 100, height: 50, borderWidth: '0' },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect, 'mp-no-border',
    )
    expect(noBorder.styles.hasBorder).toBe(false)
  })

  it('isFixedWidth：宽度 < 父宽 40% 时为 true', () => {
    // 375 * 0.4 = 150，width=100 < 150 → fixed
    const node = buildMPNode(
      { left: 0, top: 0, width: 100, height: 50 },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect, 'mp-fixed',
    )
    expect(node.styles.isFixedWidth).toBe(true)
  })

  it('isFixedWidth：宽度 >= 父宽 40% 时为 false', () => {
    // 375 * 0.4 = 150，width=200 >= 150 → not fixed
    const node = buildMPNode(
      { left: 0, top: 0, width: 200, height: 50 },
      { left: 0, top: 0, width: 200, height: 50 },
      rootRect, 'mp-not-fixed',
    )
    expect(node.styles.isFixedWidth).toBe(false)
  })

  it('maxWidth: none → Infinity', () => {
    const node = buildMPNode(
      { left: 0, top: 0, width: 100, height: 50, maxWidth: 'none' },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect, 'mp-maxw',
    )
    expect(node.styles.maxWidth).toBe(Infinity)
  })

  it('opacity 字段透传', () => {
    const node = buildMPNode(
      { left: 0, top: 0, width: 100, height: 50, opacity: '0.8' },
      { left: 0, top: 0, width: 100, height: 50 },
      rootRect, 'mp-opacity',
    )
    expect(node.styles.opacity).toBe('0.8')
  })
})
