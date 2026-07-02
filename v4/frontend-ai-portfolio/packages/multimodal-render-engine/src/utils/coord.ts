/**
 * 坐标变换工具函数
 *
 * 全部纯函数，无副作用，可在 Worker 线程使用。
 *
 * @module utils/coord
 */

import type { Point, Rect } from '../core/types';

/**
 * 将两点归一化为左上角 + 正宽高的 Rect
 *
 * 处理从右往左、从下往上拖拽的情况。
 */
export function normalizeRect(p1: Point, p2: Point): Rect {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

/** 计算矩形面积 */
export function rectArea(rect: Rect): number {
  return rect.w * rect.h;
}

/** 缩放矩形 */
export function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    w: rect.w * scale,
    h: rect.h * scale,
  };
}

/**
 * 相对坐标 → 绝对屏幕坐标
 *
 * @param rect 相对坐标系中的矩形
 * @param origin 参考原点的 DOMRect（如 container.getBoundingClientRect()）
 */
export function rectToClientRect(rect: Rect, origin: DOMRect): DOMRect {
  return new DOMRect(
    rect.x + origin.x,
    rect.y + origin.y,
    rect.w,
    rect.h,
  );
}

/**
 * 屏幕坐标 → 相对坐标
 *
 * @param pt 屏幕坐标
 * @param origin 参考原点的 DOMRect
 */
export function clientPointToRelative(pt: Point, origin: DOMRect): Point {
  return {
    x: pt.x - origin.x,
    y: pt.y - origin.y,
  };
}

/** 判断两个矩形是否重叠（含边界接触） */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

/**
 * 限制矩形最小尺寸
 */
export function clampRectSize(rect: Rect, minW: number, minH: number): Rect {
  return {
    x: rect.x,
    y: rect.y,
    w: Math.max(rect.w, minW),
    h: Math.max(rect.h, minH),
  };
}

/**
 * 按 handle 方向计算 resize 后的新矩形
 *
 * handleIndex: 0=NW 1=N 2=NE 3=E 4=SE 5=S 6=SW 7=W
 */
export function calcResizedRect(
  original: Rect,
  handleIndex: number,
  delta: Point,
  minSize = 20,
): Rect {
  let { x, y, w, h } = original;

  switch (handleIndex) {
    case 0: // NW
      x += delta.x;
      y += delta.y;
      w -= delta.x;
      h -= delta.y;
      break;
    case 1: // N
      y += delta.y;
      h -= delta.y;
      break;
    case 2: // NE
      y += delta.y;
      w += delta.x;
      h -= delta.y;
      break;
    case 3: // E
      w += delta.x;
      break;
    case 4: // SE
      w += delta.x;
      h += delta.y;
      break;
    case 5: // S
      h += delta.y;
      break;
    case 6: // SW
      x += delta.x;
      w -= delta.x;
      h += delta.y;
      break;
    case 7: // W
      x += delta.x;
      w -= delta.x;
      break;
    default:
      return original;
  }

  return clampRectSize(normalizeRect(
    { x, y },
    { x: x + w, y: y + h },
  ), minSize, minSize);
}

/**
 * 计算移动后的新矩形
 */
export function calcMovedRect(original: Rect, delta: Point): Rect {
  return {
    x: original.x + delta.x,
    y: original.y + delta.y,
    w: original.w,
    h: original.h,
  };
}