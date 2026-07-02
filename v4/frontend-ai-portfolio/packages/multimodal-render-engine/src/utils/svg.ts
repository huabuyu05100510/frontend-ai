/**
 * SVG 元素工厂
 *
 * 全部纯函数，无副作用。
 *
 * @module utils/svg
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

import type { Rect } from '../core/types';

/** 波浪线参数 */
const WAVY_AMPLITUDE = 1.5;
const WAVY_WAVELENGTH = 5;
const WAVY_LINE_WIDTH = 1.5;
const WAVY_OFFSET_Y = 2; // 距文字底部间距

/**
 * 创建 SVG 元素
 */
export function createSVGElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  setAttrs(el, attrs);
  return el;
}

/**
 * 批量设置元素属性
 */
export function setAttrs(
  el: Element,
  attrs: Record<string, string | number>,
): void {
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
}

/**
 * 生成波浪线 SVG path d 属性
 *
 * 在 y 位置绘制一条从左到右的正弦近似波浪线。
 * 每个周期使用两个二次贝塞尔曲线（q 命令）。
 *
 * @param x 起始 x
 * @param y 波浪线 y 位置（通常是 rect.bottom + WAVY_OFFSET_Y）
 * @param width 波浪线总宽度
 * @returns path d 属性字符串
 */
export function wavyPathD(x: number, y: number, width: number): string {
  if (width <= 0) return '';

  const amp = WAVY_AMPLITUDE;
  const lambda = WAVY_WAVELENGTH;
  const halfLambda = lambda / 2;
  const quarterLambda = lambda / 4;

  let d = `M ${x} ${y}`;
  let cx = x;

  while (cx < x + width) {
    d += ` q ${quarterLambda} ${-amp} ${halfLambda} 0`;
    d += ` q ${quarterLambda} ${amp} ${halfLambda} 0`;
    cx += lambda;
  }

  return d;
}

/**
 * 创建波浪线 path 元素
 *
 * @param x 起始 x
 * @param y 波浪线中心 y
 * @param width 宽度
 * @param color 颜色
 * @returns SVG <path> 元素
 */
export function createWavyPath(
  x: number,
  y: number,
  width: number,
  color: string,
): SVGPathElement {
  const path = createSVGElement('path', {
    d: wavyPathD(x, y, width),
    stroke: color,
    fill: 'none',
    'stroke-width': WAVY_LINE_WIDTH,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'pointer-events': 'none',
  });
  return path;
}

/**
 * 创建矩形框元素
 */
export function createAnnotationRect(
  rect: DOMRect,
  style: { strokeColor: string; fillColor: string; strokeWidth: number; borderRadius?: number },
): SVGRectElement {
  return createSVGElement('rect', {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    fill: style.fillColor,
    stroke: style.strokeColor,
    'stroke-width': style.strokeWidth,
    rx: style.borderRadius ?? 0,
    'pointer-events': 'none',
  });
}

/**
 * 创建文字标签元素
 */
export function createTextLabel(
  rect: DOMRect,
  text: string,
  color: string,
): SVGTextElement {
  const label = createSVGElement('text', {
    x: rect.x + 4,
    y: rect.y - 4,
    fill: color,
    'font-size': '11px',
    'font-family': 'system-ui, sans-serif',
    'pointer-events': 'none',
  });
  label.textContent = text;
  return label;
}

/**
 * Cursor 方向映射（handleIndex → cursor）
 */
const CURSOR_MAP: Record<number, string> = {
  0: 'nw-resize',
  1: 'n-resize',
  2: 'ne-resize',
  3: 'e-resize',
  4: 'se-resize',
  5: 's-resize',
  6: 'sw-resize',
  7: 'w-resize',
};

/**
 * 创建 resize 控制点
 *
 * @param cx 控制点圆心 x
 * @param cy 控制点圆心 y
 * @param handleIndex 0-7（NW, N, NE, E, SE, S, SW, W）
 * @param radius 半径（默认 5px）
 */
export function createResizeHandle(
  cx: number,
  cy: number,
  handleIndex: number,
  radius = 5,
): SVGCircleElement {
  return createSVGElement('circle', {
    cx,
    cy,
    r: radius,
    fill: '#1890ff',
    stroke: '#fff',
    'stroke-width': '2',
    'data-handle-index': handleIndex,
    'data-dir': ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'][handleIndex],
    style: `cursor: ${CURSOR_MAP[handleIndex]};`,
  });
}

/**
 * 创建预览矩形（虚线蓝框）
 */
export function createPreviewRect(rect: Rect): SVGRectElement {
  return createSVGElement('rect', {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    fill: 'none',
    stroke: '#1890ff',
    'stroke-width': '2',
    'stroke-dasharray': '6 4',
    'pointer-events': 'none',
  });
}