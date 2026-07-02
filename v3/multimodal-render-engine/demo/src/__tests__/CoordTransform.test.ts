import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImageCoordAdapter } from '../adapters/ImageCoordAdapter'
import type { Annotation } from '../core/types'

function makeImg(naturalWidth: number, displayWidth: number): HTMLImageElement {
  const img = document.createElement('img')
  Object.defineProperty(img, 'naturalWidth',  { value: naturalWidth,  configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 842,           configurable: true })
  Object.defineProperty(img, 'offsetWidth',   { value: displayWidth,  configurable: true })
  img.getBoundingClientRect = () => new DOMRect(0, 0, displayWidth, Math.round(displayWidth * 842 / naturalWidth))
  return img
}

function makeContainer(): HTMLElement {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}

function ann(x: number, y: number, w: number, h: number): Annotation {
  return {
    id: 'a1',
    type: 'ocr-region',
    position: { kind: 'pixel', bbox: { x, y, w, h } },
    content: { original: '' },
    status: 'active',
  }
}

describe('坐标变换链 — ImageCoordAdapter', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('scale=0.5 时 bbox.x=100 → screenX ≈ 50', () => {
    const img = makeImg(600, 300)   // scale = 0.5
    const container = makeContainer()
    const adapter = new ImageCoordAdapter(img, container)
    adapter.registerAnnotations([ann(100, 50, 200, 40)])
    const rects = adapter.toScreenRects({ kind: 'pixel', bbox: { x: 100, y: 50, w: 200, h: 40 } })
    expect(rects[0].x).toBeCloseTo(50, 0)
    adapter.destroy()
  })

  it('naturalWidth=595, displayWidth=300 → scale ≈ 0.504', () => {
    const img = makeImg(595, 300)
    const container = makeContainer()
    const adapter = new ImageCoordAdapter(img, container)
    adapter.registerAnnotations([ann(595, 0, 1, 1)])
    const rects = adapter.toScreenRects({ kind: 'pixel', bbox: { x: 595, y: 0, w: 1, h: 1 } })
    // 595 * (300/595) = 300
    expect(rects[0].x).toBeCloseTo(300, 0)
    adapter.destroy()
  })

  it('toScreenRects 对非 pixel position 返回空数组', () => {
    const img = makeImg(595, 300)
    const container = makeContainer()
    const adapter = new ImageCoordAdapter(img, container)
    const rects = adapter.toScreenRects({ kind: 'offset', from: 0, to: 5 })
    expect(rects).toHaveLength(0)
    adapter.destroy()
  })

  it('hitTest 返回命中的 annotation id', () => {
    const img = makeImg(595, 595)   // scale = 1
    img.getBoundingClientRect = () => new DOMRect(0, 0, 595, 842)
    const container = makeContainer()
    const adapter = new ImageCoordAdapter(img, container)
    adapter.registerAnnotations([ann(100, 100, 200, 100)])
    const hit = adapter.hitTest({ x: 150, y: 150 })
    expect(hit).toBe('a1')
    adapter.destroy()
  })

  it('hitTest 未命中时返回 null', () => {
    const img = makeImg(595, 595)
    img.getBoundingClientRect = () => new DOMRect(0, 0, 595, 842)
    const container = makeContainer()
    const adapter = new ImageCoordAdapter(img, container)
    adapter.registerAnnotations([ann(100, 100, 50, 50)])
    const hit = adapter.hitTest({ x: 500, y: 500 })
    expect(hit).toBeNull()
    adapter.destroy()
  })
})
