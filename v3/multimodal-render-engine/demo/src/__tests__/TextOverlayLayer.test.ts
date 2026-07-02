import { describe, it, expect, beforeEach } from 'vitest'
import { TextOverlayLayer } from '../layers/TextOverlayLayer'
import type { TextBlock } from '../core/types'

// jsdom 里手动创建 SVG 元素
function makeSVG(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  document.body.appendChild(svg)
  return svg
}

const IMG_RECT = new DOMRect(0, 0, 300, 424)  // 显示尺寸（scale = 300/595 ≈ 0.504）

function block(overrides: Partial<TextBlock> & { id: string; type: TextBlock['type'] }): TextBlock {
  return {
    text: 'test',
    bbox: { x: 10, y: 10, w: 100, h: 30 },
    confidence: 0.95,
    ...overrides,
  }
}

describe('TextOverlayLayer', () => {
  let svg: SVGSVGElement
  let layer: TextOverlayLayer

  beforeEach(() => {
    document.body.innerHTML = ''
    svg = makeSVG()
    layer = new TextOverlayLayer(svg)
  })

  it('formula 类型不渲染任何 SVG 子元素', () => {
    layer.render([block({ id: 'f1', type: 'formula' })], 1, IMG_RECT)
    const groups = svg.querySelectorAll('[data-id="f1"]')
    expect(groups.length).toBe(0)
  })

  it('image 类型不渲染任何 SVG 子元素', () => {
    layer.render([block({ id: 'img1', type: 'image' })], 1, IMG_RECT)
    expect(svg.querySelectorAll('[data-id="img1"]').length).toBe(0)
  })

  it('separator 类型渲染 <line> 而非 <text>', () => {
    layer.render([block({ id: 'sep1', type: 'separator', text: '' })], 1, IMG_RECT)
    const g = svg.querySelector('[data-id="sep1"]')
    expect(g).not.toBeNull()
    expect(g!.querySelector('line')).not.toBeNull()
    expect(g!.querySelector('text')).toBeNull()
  })

  it('paragraph block confidence=0.6 → <text> opacity 为 "0.6"', () => {
    layer.render([block({ id: 'p1', type: 'paragraph', confidence: 0.6 })], 1, IMG_RECT)
    const textEl = svg.querySelector('[data-id="p1"] text')
    expect(textEl).not.toBeNull()
    expect(textEl!.getAttribute('opacity')).toBe('0.6')
  })

  it('heading block 渲染 font-weight bold', () => {
    layer.render([block({ id: 'h1', type: 'heading' })], 1, IMG_RECT)
    const textEl = svg.querySelector('[data-id="h1"] text')
    expect(textEl!.getAttribute('font-weight')).toBe('bold')
  })

  it('cell block 包含 label 文字节点', () => {
    layer.render([block({ id: 'c1', type: 'cell', label: '发票代码', text: '1100161430' })], 1, IMG_RECT)
    const g = svg.querySelector('[data-id="c1"]')
    const texts = g!.querySelectorAll('text')
    const labels = Array.from(texts).map(t => t.textContent)
    expect(labels).toContain('发票代码')
  })

  it('setActiveId 后对应 <g> 有 data-active="true"', () => {
    layer.render([block({ id: 'a1', type: 'paragraph' })], 1, IMG_RECT)
    layer.setActiveId('a1')
    expect(svg.querySelector('[data-id="a1"]')!.getAttribute('data-active')).toBe('true')
  })

  it('setActiveId(null) 后所有 <g> 无 data-active', () => {
    layer.render([
      block({ id: 'a1', type: 'paragraph' }),
      block({ id: 'a2', type: 'heading' }),
    ], 1, IMG_RECT)
    layer.setActiveId('a1')
    layer.setActiveId(null)
    expect(svg.querySelectorAll('[data-active="true"]').length).toBe(0)
  })

  it('setTextVisible(false) 后所有 text 元素 display 为 none', () => {
    layer.render([
      block({ id: 'tv1', type: 'paragraph' }),
      block({ id: 'tv2', type: 'heading' }),
    ], 1, IMG_RECT)
    layer.setTextVisible(false)
    const textEls = svg.querySelectorAll('text')
    textEls.forEach(el => {
      expect(el.style.display).toBe('none')
    })
  })

  it('setTextVisible(true) 后 text 元素 display 恢复为空字符串', () => {
    layer.render([
      block({ id: 'tv3', type: 'paragraph' }),
    ], 1, IMG_RECT)
    layer.setTextVisible(false)
    layer.setTextVisible(true)
    const textEls = svg.querySelectorAll('text')
    textEls.forEach(el => {
      expect(el.style.display).not.toBe('none')
    })
  })

  it('clear() 后 SVG 无子元素', () => {
    layer.render([
      block({ id: 'x1', type: 'paragraph' }),
      block({ id: 'x2', type: 'heading' }),
    ], 1, IMG_RECT)
    layer.clear()
    expect(svg.children.length).toBe(0)
  })

  it('scale 正确缩放 bbox：scale=0.5, bbox.x=100 → x 坐标在 [50, 60) 范围内', () => {
    layer.render([block({ id: 's1', type: 'paragraph', bbox: { x: 100, y: 50, w: 200, h: 40 } })], 0.5, IMG_RECT)
    const g = svg.querySelector('[data-id="s1"]')
    const textEl = g!.querySelector('text')!
    const x = parseFloat(textEl.getAttribute('x') ?? '0')
    // scale=0.5 → sx=50，加上内边距偏移（≤8px），结果应在 [50, 58)
    expect(x).toBeGreaterThanOrEqual(50)
    expect(x).toBeLessThan(60)
  })
})
