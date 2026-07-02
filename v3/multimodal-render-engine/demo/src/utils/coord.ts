import type { Point, Rect } from '../core/types'

/** 归一化矩形，确保 x/y 为左上角，w/h 为正数 */
export function normalizeRect(p1: Point, p2: Point): Rect {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  }
}

/** 矩形面积 */
export function rectArea(rect: Rect): number {
  return rect.w * rect.h
}

/** 等比缩放矩形 */
export function scaleRect(rect: Rect, scale: number): Rect {
  return { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale }
}

/** 相对坐标 + origin 转绝对屏幕 DOMRect */
export function rectToClientRect(rect: Rect, origin: DOMRect): DOMRect {
  return new DOMRect(origin.x + rect.x, origin.y + rect.y, rect.w, rect.h)
}

/** 屏幕绝对坐标转相对于 origin 的坐标 */
export function clientPointToRelative(pt: Point, origin: DOMRect): Point {
  return { x: pt.x - origin.x, y: pt.y - origin.y }
}

/** 判断两个矩形是否重叠 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

/** Rect 转 DOMRect */
export function rectToDOMRect(rect: Rect): DOMRect {
  return new DOMRect(rect.x, rect.y, rect.w, rect.h)
}
