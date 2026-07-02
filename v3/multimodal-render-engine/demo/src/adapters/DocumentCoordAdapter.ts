import type { Annotation, Position, Point, Rect, PagePosition } from '../core/types'
import type { CoordAdapter } from './CoordAdapter'
import { SpatialIndex } from '../utils/rtree'

/**
 * 文档场景坐标适配器
 * 将页面 pt 坐标映射到屏幕 CSS 坐标
 */
export class DocumentCoordAdapter implements CoordAdapter {
  private index = new SpatialIndex()
  private annotations: Annotation[] = []

  constructor(
    private pageRefs: Map<number, HTMLElement>,
    private pageWidthPt: number
  ) {}

  /** 注册标注，构建空间索引 */
  registerAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations
    this.rebuildIndex()
  }

  toScreenRects(pos: Position): DOMRect[] {
    if (pos.kind !== 'page') return []
    const pagePos = pos as PagePosition
    const pageEl = this.pageRefs.get(pagePos.page)
    if (!pageEl) return []
    const bcr = pageEl.getBoundingClientRect()
    const scale = bcr.width / this.pageWidthPt
    const { bbox } = pagePos
    return [
      new DOMRect(
        bcr.x + bbox.x * scale,
        bcr.y + bbox.y * scale,
        bbox.w * scale,
        bbox.h * scale
      ),
    ]
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
    this.index.clear()
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
