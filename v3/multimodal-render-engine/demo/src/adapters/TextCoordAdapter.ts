import type { Annotation, Position, Point, Rect, OffsetPosition } from '../core/types'
import type { CoordAdapter } from './CoordAdapter'
import { SpatialIndex } from '../utils/rtree'

/**
 * 文本场景坐标适配器
 * 通过 Range API 将字符偏移量映射到屏幕 DOMRect
 */
export class TextCoordAdapter implements CoordAdapter {
  private index = new SpatialIndex()
  private annotations: Annotation[] = []
  private rafId: number | null = null
  private resizeObserver: ResizeObserver
  private mutationObserver: MutationObserver

  constructor(
    private editorEl: HTMLElement,
    private getNodeAt: (offset: number) => { node: Text; offset: number } | null
  ) {
    this.resizeObserver = new ResizeObserver(() => this.scheduleInvalidate())
    this.resizeObserver.observe(editorEl)

    this.mutationObserver = new MutationObserver(() => this.scheduleInvalidate())
    this.mutationObserver.observe(editorEl, {
      attributes: true,
      subtree: true,
      attributeFilter: ['style', 'class'],
    })

    document.fonts.ready.then(() => this.scheduleInvalidate())
  }

  /** 注册标注 */
  registerAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations
    this.scheduleInvalidate()
  }

  toScreenRects(pos: Position): DOMRect[] {
    if (pos.kind !== 'offset') return []
    const p = pos as OffsetPosition
    const startInfo = this.getNodeAt(p.from)
    const endInfo = this.getNodeAt(p.to)
    if (!startInfo || !endInfo) return []
    try {
      const range = document.createRange()
      range.setStart(startInfo.node, startInfo.offset)
      range.setEnd(endInfo.node, endInfo.offset)
      return Array.from(range.getClientRects())
    } catch {
      return []
    }
  }

  hitTest(pt: Point): string | null {
    return this.index.hitTest(pt)
  }

  rangeSearch(rect: Rect): string[] {
    return this.index.rangeSearch(rect)
  }

  invalidate(): void {
    this.rebuildIndex()
  }

  destroy(): void {
    this.resizeObserver.disconnect()
    this.mutationObserver.disconnect()
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.index.clear()
  }

  /** 双 rAF 等 layout 稳定后重算 */
  private scheduleInvalidate(): void {
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null
        this.rebuildIndex()
      })
    })
  }

  private rebuildIndex(): void {
    const items: Array<{ id: string; rect: DOMRect }> = []
    for (const a of this.annotations) {
      const rects = this.toScreenRects(a.position)
      rects.forEach(r => items.push({ id: a.id, rect: r }))
    }
    this.index.rebuild(items)
  }
}
