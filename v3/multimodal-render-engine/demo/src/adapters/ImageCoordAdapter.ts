import type { Annotation, Position, Point, Rect } from '../core/types'
import type { CoordAdapter } from './CoordAdapter'
import { SpatialIndex } from '../utils/rtree'

/**
 * 图片场景坐标适配器
 * 将图片像素坐标映射到屏幕 CSS 坐标
 */
export class ImageCoordAdapter implements CoordAdapter {
  private index = new SpatialIndex()
  private annotations: Annotation[] = []
  private resizeObserver: ResizeObserver

  constructor(
    private imgEl: HTMLImageElement,
    private containerEl: HTMLElement
  ) {
    this.resizeObserver = new ResizeObserver(() => this.invalidate())
    this.resizeObserver.observe(containerEl)
  }

  /** 注册标注，构建空间索引 */
  registerAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations
    this.rebuildIndex()
  }

  toScreenRects(pos: Position): DOMRect[] {
    if (pos.kind !== 'pixel') return []
    const scale = this.getScale()
    // 使用 img 元素自身的 BCR（而非容器 BCR），正确处理 margin/padding 偏移
    const bcr = this.imgEl.getBoundingClientRect()
    const { bbox } = pos
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
    this.resizeObserver.disconnect()
    this.index.clear()
  }

  /** 真实显示缩放比：img 显示宽度 / 原始宽度 */
  private getScale(): number {
    const naturalWidth = this.imgEl.naturalWidth || 1
    return (this.imgEl.offsetWidth || this.containerEl.offsetWidth) / naturalWidth
  }

  private rebuildIndex(): void {
    const scale = this.getScale()
    const bcr = this.imgEl.getBoundingClientRect()
    const items = this.annotations
      .filter(a => a.position.kind === 'pixel')
      .map(a => {
        const bbox = (a.position as { kind: 'pixel'; bbox: Rect }).bbox
        return {
          id: a.id,
          rect: new DOMRect(
            bcr.x + bbox.x * scale,
            bcr.y + bbox.y * scale,
            bbox.w * scale,
            bbox.h * scale
          ),
        }
      })
    this.index.rebuild(items)
  }
}
