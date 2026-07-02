import type { AnnotationType, BoxStyle, Rect } from '../core/types'
import { makeSVGElement, setAttrs, wavyPathD } from '../utils/svg'

/** 各标注类型对应的颜色 */
export const CATEGORY_COLOR: Record<AnnotationType, string> = {
  'error-spelling':        '#ff4d4f',
  'error-grammar':         '#fa8c16',
  'error-punctuation':     '#1890ff',
  'error-number':          '#52c41a',
  'error-political':       '#722ed1',
  'ocr-region':            '#13c2c2',
  'ocr-field':             '#1890ff',
  'translation-paragraph': '#d9d9d9',
}

/**
 * SVG 标注层工厂
 * 负责在 SVG 元素上绘制所有标注视觉元素
 */
export class SVGLayer {
  private groups = new Map<string, SVGGElement>()
  private previewRect: SVGRectElement | null = null

  constructor(private svgEl: SVGSVGElement) {
    setAttrs(svgEl, {
      style: 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none',
    })
  }

  /**
   * 在 rects 列表每个 rect 底部 +2px 绘制波浪线
   */
  addWavyUnderline(id: string, rects: DOMRect[], color: string): void {
    const svgBCR = this.svgEl.getBoundingClientRect()
    const g = this.getOrCreateGroup(id)
    rects.forEach(rect => {
      const x = rect.left - svgBCR.left
      const y = rect.bottom - svgBCR.top + 2
      const path = makeSVGElement('path', {
        d: wavyPathD(x, y, rect.width),
        stroke: color,
        'stroke-width': 1.5,
        fill: 'none',
        'pointer-events': 'none',
        class: 'wavy-path',
      })
      g.appendChild(path)
    })
  }

  /**
   * 添加矩形标注框
   */
  addAnnotationBox(id: string, rect: DOMRect, style: BoxStyle): void {
    const svgBCR = this.svgEl.getBoundingClientRect()
    const g = this.getOrCreateGroup(id)
    const x = rect.left - svgBCR.left
    const y = rect.top - svgBCR.top
    const r = makeSVGElement('rect', {
      x,
      y,
      width: rect.width,
      height: rect.height,
      stroke: style.strokeColor,
      'stroke-width': style.strokeWidth,
      fill: style.fillColor,
      rx: style.borderRadius ?? 2,
      'pointer-events': 'none',
      class: 'annotation-box',
    })
    g.appendChild(r)
  }

  /**
   * 在矩形框左上角添加文字标签
   */
  addTextLabel(id: string, rect: DOMRect, text: string, color: string): void {
    const svgBCR = this.svgEl.getBoundingClientRect()
    const g = this.getOrCreateGroup(id)
    const x = rect.left - svgBCR.left
    const y = rect.top - svgBCR.top

    const bg = makeSVGElement('rect', {
      x: x - 1,
      y: y - 14,
      width: text.length * 7 + 6,
      height: 14,
      fill: color,
      rx: 2,
      'pointer-events': 'none',
    })
    const label = makeSVGElement('text', {
      x: x + 2,
      y: y - 2,
      fill: '#fff',
      'font-size': 10,
      'font-family': 'sans-serif',
      'pointer-events': 'none',
      class: 'text-label',
    })
    label.textContent = text
    g.appendChild(bg)
    g.appendChild(label)
  }

  /**
   * 控制高亮状态
   */
  setHighlight(id: string, on: boolean, mode: 'hover' | 'selected' = 'hover'): void {
    const g = this.groups.get(id)
    if (!g) return
    g.classList.remove('highlight-hover', 'highlight-selected')
    if (on) {
      g.classList.add(mode === 'hover' ? 'highlight-hover' : 'highlight-selected')
    }
  }

  /**
   * 显示 8 个 resize 控制点
   */
  showResizeHandles(id: string): void {
    const g = this.groups.get(id)
    if (!g) return
    const boxEl = g.querySelector('.annotation-box') as SVGRectElement | null
    if (!boxEl) return

    this.hideResizeHandles()

    const x = parseFloat(boxEl.getAttribute('x') ?? '0')
    const y = parseFloat(boxEl.getAttribute('y') ?? '0')
    const w = parseFloat(boxEl.getAttribute('width') ?? '0')
    const h = parseFloat(boxEl.getAttribute('height') ?? '0')

    const handles: Array<[string, number, number]> = [
      ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y],
      ['e', x + w, y + h / 2],
      ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h],
      ['w', x, y + h / 2],
    ]

    handles.forEach(([dir, cx, cy]) => {
      const c = makeSVGElement('circle', {
        cx,
        cy,
        r: 5,
        fill: '#1890ff',
        stroke: '#fff',
        'stroke-width': 1.5,
        class: 'resize-handle',
        'data-dir': dir,
        'data-annotation-id': id,
        style: `cursor:${dir}-resize`,
        'pointer-events': 'all',
      })
      g.appendChild(c)
    })
  }

  /** 隐藏所有 resize 控制点 */
  hideResizeHandles(): void {
    this.svgEl.querySelectorAll('.resize-handle').forEach(el => el.remove())
  }

  /** 绘制拖拽预览矩形（虚线蓝框） */
  showPreviewRect(rect: Rect): void {
    if (this.previewRect) this.previewRect.remove()
    const r = makeSVGElement('rect', {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      stroke: '#1890ff',
      'stroke-width': 1.5,
      'stroke-dasharray': '4 4',
      fill: 'rgba(24,144,255,0.05)',
      'pointer-events': 'none',
      class: 'preview-rect',
    })
    this.svgEl.appendChild(r)
    this.previewRect = r
  }

  /** 更新预览矩形 */
  updatePreviewRect(rect: Rect): void {
    if (!this.previewRect) {
      this.showPreviewRect(rect)
      return
    }
    setAttrs(this.previewRect, { x: rect.x, y: rect.y, width: rect.w, height: rect.h })
  }

  /** 隐藏预览矩形 */
  hidePreviewRect(): void {
    this.previewRect?.remove()
    this.previewRect = null
  }

  /** 移除指定 id 的标注组 */
  remove(id: string): void {
    const g = this.groups.get(id)
    g?.remove()
    this.groups.delete(id)
  }

  /** 清空所有标注 */
  clear(): void {
    this.groups.forEach(g => g.remove())
    this.groups.clear()
    this.previewRect?.remove()
    this.previewRect = null
  }

  private getOrCreateGroup(id: string): SVGGElement {
    if (this.groups.has(id)) return this.groups.get(id)!
    const g = makeSVGElement('g', { 'data-id': id })
    this.svgEl.appendChild(g)
    this.groups.set(id, g)
    return g
  }
}
