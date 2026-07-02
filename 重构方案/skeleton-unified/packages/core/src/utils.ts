/**
 * @skeleton/core - 工具函数
 *
 * 所有工具函数均为纯函数，无副作用，无平台依赖。
 */

import type { Rect } from './types.js'

// ─── 坐标转换 ─────────────────────────────────────────────────────────────────

/**
 * 将绝对像素坐标转为相对于根节点的百分比。
 * 保留 2 位小数（±0.01% 误差在视觉上完全不可见）。
 *
 * @param value 绝对像素值
 * @param base  参照基准（容器宽度或容器高度）
 */
export function toPercent(value: number, base: number): number {
  if (base <= 0) return 0
  return round2((value / base) * 100)
}

/** 四舍五入到 2 位小数 */
export function round2(n: number): number {
  if (!isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

/** 四舍五入到 N 位小数 */
export function roundN(n: number, digits: number): number {
  if (!isFinite(n)) return 0
  const factor = Math.pow(10, digits)
  return Math.round(n * factor) / factor
}

/**
 * 将 NodeMeasurement.rect（绝对像素）转换为相对于 rootRect 的百分比坐标。
 * x/w 相对于 rootRect.width，y/h 相对于 rootRect.height。
 */
export function rectToPercent(
  rect: Rect,
  rootRect: Rect,
): { x: number; y: number; w: number; h: number } {
  const rw = rootRect.width
  const rh = rootRect.height
  return {
    x: toPercent(rect.left - rootRect.left, rw),
    y: toPercent(rect.top - rootRect.top, rh),
    w: toPercent(rect.width, rw),
    h: toPercent(rect.height, rh),
  }
}

// ─── 圆角解析 ─────────────────────────────────────────────────────────────────

/**
 * 解析 border-radius CSS 字符串，返回骨架渲染可用的值。
 *
 * 规则：
 * - '50%' 原样返回（圆形）
 * - '9999px' / '9999' 等超大值：方形节点 → '50%'（完整圆），矩形 → 9999（胶囊）
 * - 四角相同 → 单数值（px）
 * - 四角不同 → CSS 字符串 '8px 8px 0px 8px'
 * - 0 → undefined（无圆角，渲染器用默认值 8）
 *
 * @param borderRadius CSS border-radius 字符串（来自 getComputedStyle）
 * @param rect         节点矩形（用于判断是否方形）
 */
export function parseRadius(
  borderRadius: string,
  rect?: { width: number; height: number },
): number | string | undefined {
  if (!borderRadius || borderRadius === 'none') return undefined

  // '50%' 直接圆形
  if (borderRadius === '50%') return '50%'

  // 解析四角 px 值（getComputedStyle 返回的是 px 字符串，即使原始是 %）
  const corners = parseFourCorners(borderRadius)
  if (!corners) return undefined

  const [tl, tr, br, bl] = corners
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined

  const maxCorner = Math.max(tl, tr, br, bl)

  // 超大圆角（border-radius: 9999px / rounded-full）
  if (maxCorner > 9998) {
    if (rect) {
      const isSquarish = Math.abs(rect.width - rect.height) < 4
      return isSquarish ? '50%' : 9999
    }
    return 9999
  }

  // 四角相同
  if (tl === tr && tr === br && br === bl) return tl

  // 四角不同
  return `${tl}px ${tr}px ${br}px ${bl}px`
}

/** 解析四角圆角（px 值），支持 '8px' / '8px 4px' / '8px 4px 2px 0px' 等格式 */
function parseFourCorners(val: string): [number, number, number, number] | null {
  const parts = val.trim().split(/\s+/)
  const nums = parts.map(p => parseFloat(p))
  if (nums.some(n => isNaN(n))) return null
  if (nums.length === 1) return [nums[0], nums[0], nums[0], nums[0]]
  if (nums.length === 2) return [nums[0], nums[1], nums[0], nums[1]]
  if (nums.length === 3) return [nums[0], nums[1], nums[2], nums[1]]
  if (nums.length === 4) return [nums[0], nums[1], nums[2], nums[3]]
  return null
}

// ─── 颜色工具 ─────────────────────────────────────────────────────────────────

const RGBA_REGEX = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/

/**
 * 调亮/加深颜色（用于骨架容器背景颜色计算）。
 *
 * - hex 颜色：每通道向白色线性插值 `channel + (255 - channel) * amount`
 * - rgba：微调 alpha
 * - 不支持的格式原样返回
 *
 * @param color  CSS 颜色字符串（#rrggbb 或 rgba(...)）
 * @param amount 调整幅度 0~1，正值变亮
 */
export function adjustColor(color: string, amount: number): string {
  const rgbaMatch = color.match(RGBA_REGEX)
  if (rgbaMatch) {
    const [, r, g, b, a = '1'] = rgbaMatch
    const newAlpha = Math.min(1, parseFloat(a) + amount * 0.5)
    return `rgba(${r},${g},${b},${newAlpha.toFixed(3)})`
  }

  if (color.startsWith('#') && color.length >= 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      const nr = Math.round(r + (255 - r) * amount)
      const ng = Math.round(g + (255 - g) * amount)
      const nb = Math.round(b + (255 - b) * amount)
      return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
    }
  }

  return color
}

/** 判断颜色是否透明（rgba(0,0,0,0) 或 transparent） */
export function isTransparent(color: string): boolean {
  return (
    color === 'rgba(0, 0, 0, 0)' ||
    color === 'transparent' ||
    color === '' ||
    color === 'initial' ||
    color === 'inherit'
  )
}

// ─── 断点解析 ─────────────────────────────────────────────────────────────────

/**
 * 从响应式骨架中选择最合适的断点。
 * 找到 ≤ 当前宽度的最大断点（lower bound）。
 *
 * @param breakpoints  断点 map（key = 最小宽度）
 * @param containerWidth 当前容器宽度（px）
 */
export function resolveBreakpoint<T>(
  breakpoints: Record<number, T>,
  containerWidth: number,
): T | null {
  const bps = Object.keys(breakpoints).map(Number).sort((a, b) => a - b)
  if (bps.length === 0) return null
  const match = [...bps].reverse().find(bp => containerWidth >= bp) ?? bps[0]
  return breakpoints[match] ?? null
}

// ─── 动画常量 ─────────────────────────────────────────────────────────────────

export const SHIMMER_DEFAULTS = {
  angle: 110,
  start: 30,
  end: 70,
  speed: '2s',
  lightHighlight: '#f7f7f7',
  darkHighlight: '#2c2c2c',
} as const

export const PULSE_DEFAULTS = {
  speed: '1.8s',
  lightAdjust: 0.3,
  darkAdjust: 0.02,
} as const

export const CONTAINER_DEFAULTS = {
  lightAdjustment: 0.12,
  darkAdjustment: 0.03,
} as const

export const COLOR_DEFAULTS = {
  light: '#f0f0f0',
  dark: '#222222',
} as const

// ─── 内容哈希（增量构建用）────────────────────────────────────────────────────

/**
 * 简单 FNV-1a 32bit 哈希，用于增量构建时检测骨架是否需要重新捕获。
 * 比 MD5 快 10x，碰撞率足够低（骨架 diff 场景不需要密码级安全）。
 */
export function fnv1a32(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
