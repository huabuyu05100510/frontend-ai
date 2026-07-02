/**
 * TextOverlayLayer
 * 在 SVG 上将服务端返回的 TextBlock[] 按 bbox + type 渲染为文字覆盖层。
 *
 * 三层渲染架构中的 Layer 3：
 *   Layer 1: <img> 原始图像
 *   Layer 2: <canvas> 置信度热力图（ConfidenceHeatmap）
 *   Layer 3: <svg> 文字覆盖（本层） + 标注框交互
 */

import type { TextBlock, BlockType } from '../core/types'

// ── 每种 BlockType 对应的 SVG text 样式 ──────────────────────

interface BlockStyle {
  fontSize: number
  fontWeight: string
  fill: string
  /** 标题类型在文字下方绘制实线 */
  underline?: boolean
}

const BLOCK_STYLES: Record<BlockType, BlockStyle | null> = {
  heading:   { fontSize: 18, fontWeight: 'bold',   fill: '#4B0082', underline: true },
  paragraph: { fontSize: 12, fontWeight: 'normal', fill: '#333333' },
  cell:      { fontSize: 12, fontWeight: 'normal', fill: '#1a1a1a' },
  caption:   { fontSize: 11, fontWeight: 'normal', fill: '#888888' },
  formula:   null,   // pass-through
  image:     null,   // pass-through
  separator: null,   // 渲染为 <line>，不是 <text>
}

function svgNS(tag: string): Element {
  return document.createElementNS('http://www.w3.org/2000/svg', tag)
}

function setAttrs(el: Element, attrs: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
}

// ── 主类 ─────────────────────────────────────────────────────

export class TextOverlayLayer {
  private groups = new Map<string, SVGGElement>()

  constructor(private svgEl: SVGSVGElement) {}

  /**
   * 渲染 blocks 到 SVG。
   * @param blocks  TextBlock 数组（服务端返回）
   * @param scale   displayWidth / naturalWidth
   * @param imgRect 图片在容器中的位置（getBoundingClientRect）
   */
  render(blocks: TextBlock[], scale: number, imgRect: DOMRect): void {
    this.clear()

    for (const block of blocks) {
      const style = BLOCK_STYLES[block.type]

      // formula / image → pass-through，不渲染
      if (style === null && block.type !== 'separator') continue

      const g = svgNS('g') as SVGGElement
      g.setAttribute('data-id', block.id)

      const { x, y, w, h } = block.bbox
      const sx = imgRect.x + x * scale
      const sy = imgRect.y + y * scale
      const sw = w * scale
      const sh = h * scale

      if (block.type === 'separator') {
        // 渲染为水平虚线
        const line = svgNS('line')
        setAttrs(line, {
          x1: sx, y1: sy + sh / 2,
          x2: sx + sw, y2: sy + sh / 2,
          stroke: '#d9d9d9',
          'stroke-width': 1,
          'stroke-dasharray': '4 3',
        })
        g.appendChild(line)
      } else if (style) {
        const opacity = block.confidence ?? 1

        // ── box 模式背景框（默认隐藏，box 模式时通过 setTextVisible 显示）──
        const boxRect = svgNS('rect')
        setAttrs(boxRect, {
          'data-box': 'true',
          x: sx, y: sy, width: sw, height: sh,
          fill: 'rgba(24,144,255,0.06)',
          stroke: '#1890ff',
          'stroke-width': 1,
          rx: 2,
          opacity: 0,  // 初始隐藏
        })
        g.appendChild(boxRect)

        // ── hover 高亮框（默认隐藏，hover 时显示）──
        const hoverRect = svgNS('rect')
        setAttrs(hoverRect, {
          'data-hover': 'true',
          x: sx - 1, y: sy - 1, width: sw + 2, height: sh + 2,
          fill: 'rgba(24,144,255,0.12)',
          stroke: '#1890ff',
          'stroke-width': 2,
          rx: 3,
          display: 'none',
        })
        g.appendChild(hoverRect)

        // cell 类型：先渲染 label（左上角小字）
        if (block.type === 'cell' && block.label) {
          const labelEl = svgNS('text')
          setAttrs(labelEl, {
            x: sx + 2, y: sy + 10,
            'font-size': 9,
            'font-weight': 'normal',
            fill: '#888888',
            opacity,
          })
          labelEl.textContent = block.label
          g.appendChild(labelEl)
        }

        // 主文字
        const textEl = svgNS('text')
        const textY = block.type === 'cell' && block.label
          ? sy + sh - 6          // label 占上部，value 在底部
          : sy + sh / 2 + style.fontSize / 3

        setAttrs(textEl, {
          x: sx + 2,
          y: textY,
          'font-size': style.fontSize,
          'font-weight': style.fontWeight,
          fill: style.fill,
          opacity,
        })
        textEl.textContent = block.text
        g.appendChild(textEl)

        // heading 下划线
        if (style.underline) {
          const line = svgNS('line')
          setAttrs(line, {
            x1: sx, y1: sy + sh - 2,
            x2: sx + sw, y2: sy + sh - 2,
            stroke: style.fill,
            'stroke-width': 1.5,
            opacity,
          })
          g.appendChild(line)
        }

        // 低置信度：橙色 / 红色边框
        if (opacity < 0.9) {
          const borderColor = opacity < 0.7 ? '#ff4d4f' : '#fa8c16'
          const rect = svgNS('rect')
          setAttrs(rect, {
            x: sx, y: sy, width: sw, height: sh,
            fill: 'none',
            stroke: borderColor,
            'stroke-width': 1,
            'stroke-dasharray': opacity < 0.7 ? '4 2' : 'none',
            rx: 2,
          })
          g.appendChild(rect)
        }
      }

      this.svgEl.appendChild(g)
      this.groups.set(block.id, g)
    }
  }

  /** 设置当前激活（hover）的 block id，显示对应高亮框 */
  setActiveId(id: string | null): void {
    for (const [gid, g] of this.groups) {
      const hoverRect = g.querySelector('[data-hover]')
      if (gid === id) {
        g.setAttribute('data-active', 'true')
        hoverRect?.setAttribute('display', 'block')
      } else {
        g.removeAttribute('data-active')
        hoverRect?.setAttribute('display', 'none')
      }
    }
  }

  /**
   * 切换显示模式：
   * - text 模式（visible=true）：显示文字，隐藏 box 框
   * - box  模式（visible=false）：隐藏文字，显示 box 框
   */
  setTextVisible(visible: boolean): void {
    this.svgEl.querySelectorAll('text').forEach(el => {
      (el as unknown as SVGElement & { style: CSSStyleDeclaration }).style.display = visible ? '' : 'none'
    })
    this.svgEl.querySelectorAll('[data-box]').forEach(el => {
      el.setAttribute('opacity', visible ? '0' : '1')
    })
  }

  /** 清空所有渲染内容 */
  clear(): void {
    this.groups.forEach(g => g.remove())
    this.groups.clear()
  }
}
