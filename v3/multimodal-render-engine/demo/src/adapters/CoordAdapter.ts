import type { Position, Point, Rect } from '../core/types'

/**
 * 坐标适配器接口
 * 将不同坐标系（像素/页面/字符偏移）统一映射到屏幕 DOMRect
 */
export interface CoordAdapter {
  /** 标注位置 → 屏幕 DOMRect（跨行返回多个） */
  toScreenRects(pos: Position): DOMRect[]

  /** 屏幕点 → 命中的 annotation id */
  hitTest(pt: Point): string | null

  /** 矩形范围查询 → 命中的 annotation ids */
  rangeSearch(rect: Rect): string[]

  /** 布局变化时通知失效 */
  invalidate(): void

  destroy(): void
}
