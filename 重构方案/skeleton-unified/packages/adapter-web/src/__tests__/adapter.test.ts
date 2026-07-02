// @vitest-environment jsdom

/**
 * @skeleton/adapter-web - DOM 适配器测试
 *
 * 使用 jsdom（Vitest 默认 happy-dom/jsdom 环境）模拟 DOM 测量。
 * 注意：jsdom 中 getBoundingClientRect() 默认返回全零，需要 mock。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── mock getBoundingClientRect / getComputedStyle ────────────────────────────

// mock辅助函数注释保留

// ─── 测试 ──────────────────────────────────────────────────────────────────────

describe('adapter-web - measureDOM 基础', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('空容器返回正确根节点结构', async () => {
    // 直接测试 getVisibleRect 等内部逻辑（通过 measureDOM 间接）
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 375, height: 200,
      right: 375, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    })

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      borderRadius: '0px',
      borderTopWidth: '0px',
      borderTopColor: 'rgba(0, 0, 0, 0)',
      flexGrow: '0',
      flexShrink: '1',
      minWidth: '0px',
      maxWidth: 'none',
      minHeight: '0px',
      maxHeight: 'none',
      boxShadow: 'none',
    } as CSSStyleDeclaration)

    const { measureDOM } = await import('../adapter.js')
    const tree = await measureDOM(root)

    expect(tree.tag).toBe('div')
    expect(tree.rect.width).toBe(375)
    expect(tree.rect.height).toBe(200)
    expect(tree.isLeaf).toBe(false)
    expect(tree.children).toHaveLength(0)
  })

  it('叶节点标签正确识别', async () => {
    const leafTags = ['img', 'svg', 'input', 'button', 'canvas', 'p', 'h1']
    for (const tag of leafTags) {
      const el = document.createElement(tag)
      el.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 100, height: 50,
        right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}),
      })

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        overflow: 'visible',
        overflowX: 'visible',
        overflowY: 'visible',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'none',
        borderRadius: '0px',
        borderTopWidth: '0px',
        borderTopColor: 'rgba(0, 0, 0, 0)',
        flexGrow: '0',
        flexShrink: '1',
        minWidth: '0px',
        maxWidth: 'none',
        minHeight: '0px',
        maxHeight: 'none',
        boxShadow: 'none',
      } as CSSStyleDeclaration)

      const root = document.createElement('div')
      root.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 375, height: 200,
        right: 375, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
      })
      root.appendChild(el)

      const { measureDOM } = await import('../adapter.js')
      const tree = await measureDOM(root)
      const child = tree.children[0]

      if (child) {
        expect(child.isLeaf, `${tag} should be leaf`).toBe(true)
      }
      vi.restoreAllMocks()
    }
  })

  it('display:none 子节点被过滤', async () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 375, height: 200,
      right: 375, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    })

    const hiddenChild = document.createElement('div')
    hiddenChild.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 100, height: 50,
      right: 110, bottom: 60, x: 10, y: 10, toJSON: () => ({}),
    })
    root.appendChild(hiddenChild)

    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === hiddenChild) {
        return { display: 'none' } as CSSStyleDeclaration
      }
      return {
        display: 'block', visibility: 'visible', opacity: '1',
        overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
        backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
        borderRadius: '0px', borderTopWidth: '0px', borderTopColor: 'rgba(0, 0, 0, 0)',
        flexGrow: '0', flexShrink: '1', minWidth: '0px', maxWidth: 'none',
        minHeight: '0px', maxHeight: 'none', boxShadow: 'none',
      } as CSSStyleDeclaration
    })

    const { measureDOM } = await import('../adapter.js')
    const tree = await measureDOM(root)
    expect(tree.children).toHaveLength(0)
  })
})

describe('adapter-web - NodeStyles 字段', () => {
  it('带边框的元素 hasBorder=true', async () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 375, height: 200,
      right: 375, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    })

    const child = document.createElement('div')
    child.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 100, height: 50,
      right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}),
    })
    root.appendChild(child)

    const sharedStyle = {
      display: 'block', visibility: 'visible', opacity: '1',
      overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      borderRadius: '0px', flexGrow: '0', flexShrink: '1',
      minWidth: '0px', maxWidth: 'none', minHeight: '0px', maxHeight: 'none',
      boxShadow: 'none',
    }

    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === child) {
        return {
          ...sharedStyle,
          borderTopWidth: '2px',
          borderTopColor: 'rgb(0, 0, 0)',
        } as CSSStyleDeclaration
      }
      return { ...sharedStyle, borderTopWidth: '0px', borderTopColor: 'rgba(0, 0, 0, 0)' } as CSSStyleDeclaration
    })

    const { measureDOM } = await import('../adapter.js')
    const tree = await measureDOM(root)
    expect(tree.children[0]?.styles.hasBorder).toBe(true)
  })

  it('minWidth 正确解析', async () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 375, height: 200,
      right: 375, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    })

    const child = document.createElement('button')
    child.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 200, height: 40,
      right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}),
    })
    root.appendChild(child)

    const baseStyle = {
      display: 'block', visibility: 'visible', opacity: '1',
      overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      borderRadius: '0px', borderTopWidth: '0px', borderTopColor: 'rgba(0, 0, 0, 0)',
      flexGrow: '0', flexShrink: '1', maxWidth: 'none',
      minHeight: '0px', maxHeight: 'none', boxShadow: 'none',
    }

    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === child) {
        return { ...baseStyle, minWidth: '80px' } as CSSStyleDeclaration
      }
      return { ...baseStyle, minWidth: '0px' } as CSSStyleDeclaration
    })

    const { measureDOM } = await import('../adapter.js')
    const tree = await measureDOM(root)
    expect(tree.children[0]?.styles.minWidth).toBe(80)
  })
})
