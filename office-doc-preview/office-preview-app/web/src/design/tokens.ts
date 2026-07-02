// 大厂风格设计 tokens — 对标 字节飞书 / Ant Design / 腾讯文档
// 模型：claude-sonnet-4-6
// 单一事实源：颜色 / 字号 / 间距 / 圆角 / 阴影 / 断点
// styles.css 通过 :root CSS vars 同步消费（避免重复定义）

/** 主色 — Ant Design 蓝，专业可信赖 */
export const COLORS = {
  // Brand
  primary: '#1677ff',
  primaryHover: '#4096ff',
  primaryActive: '#0958d9',
  primaryBg: '#e6f4ff',
  primaryBgHover: '#bae0ff',

  // AI 标识 — 紫色
  ai: '#722ed1',
  aiHover: '#9254de',
  aiBg: '#f9f0ff',

  // 中性
  text: '#1f2329',
  textSecondary: '#4e5969',
  textTertiary: '#86909c',
  textPlaceholder: '#c9cdd4',
  textInverse: '#ffffff',

  // 背景
  bg: '#ffffff',
  bgLayout: '#f5f6f7',     // canvas
  bgSubtle: '#fafafa',
  bgHover: '#f2f3f5',
  bgMask: 'rgba(0,0,0,0.45)',

  // 边框
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  borderLight: '#f0f1f3',

  // 状态
  success: '#52c41a',
  successBg: '#f6ffed',
  warning: '#faad14',
  warningBg: '#fffbe6',
  danger: '#ff4d4f',
  dangerBg: '#fff1f0',
  info: '#1677ff',
  infoBg: '#e6f4ff',
} as const

/** 字号 — 8 级（Material/Tailwind 对齐） */
export const FONT_SIZES = {
  xs: '12px',
  sm: '13px',
  base: '14px',
  md: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
} as const

/** 字重 */
export const FONT_WEIGHTS = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const

/** 行高 */
export const LINE_HEIGHTS = {
  tight: 1.25,
  base: 1.5,
  relaxed: 1.7,
} as const

/** 间距 — 8 倍数（Material Design 对齐） */
export const SPACE = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  base: '16px',
  lg: '20px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
  '4xl': '64px',
} as const

/** 圆角 */
export const RADIUS = {
  none: '0',
  sm: '4px',
  base: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const

/** 阴影 — 克制、subtle */
export const SHADOW = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,.04)',
  base: '0 2px 8px rgba(0,0,0,.06)',
  md: '0 4px 12px rgba(0,0,0,.08)',
  lg: '0 8px 24px rgba(0,0,0,.10)',
  xl: '0 12px 32px rgba(0,0,0,.12)',
} as const

/** 断点 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

/** 布局尺寸 */
export const LAYOUT = {
  topBarHeight: 56,
  sideMenuWidth: 220,
  sideMenuCollapsedWidth: 64,
  rightPanelWidth: 320,
  rightPanelCollapsedWidth: 48,
  contentMaxWidth: 1280,
} as const

/** z-index 分层 */
export const Z_INDEX = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  fixed: 1200,
  modalBackdrop: 1300,
  modal: 1400,
  popover: 1500,
  tooltip: 1600,
  notification: 1700,
} as const

/** 过渡时长 */
export const TRANSITION = {
  fast: '120ms cubic-bezier(0.4, 0, 0.2, 1)',
  base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
} as const

/** 字体栈 */
export const FONT_FAMILY = {
  base: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
} as const

/** 生成 CSS 变量字符串（注入 :root） */
export function toCSSVars(): string {
  const lines: string[] = []
  // 颜色
  for (const [k, v] of Object.entries(COLORS)) {
    lines.push(`  --color-${kebab(k)}: ${v};`)
  }
  // 字号
  for (const [k, v] of Object.entries(FONT_SIZES)) {
    lines.push(`  --font-size-${k}: ${v};`)
  }
  // 字重
  for (const [k, v] of Object.entries(FONT_WEIGHTS)) {
    lines.push(`  --font-weight-${k}: ${v};`)
  }
  // 行高
  for (const [k, v] of Object.entries(LINE_HEIGHTS)) {
    lines.push(`  --line-height-${k}: ${v};`)
  }
  // 间距
  for (const [k, v] of Object.entries(SPACE)) {
    lines.push(`  --space-${k}: ${v};`)
  }
  // 圆角
  for (const [k, v] of Object.entries(RADIUS)) {
    lines.push(`  --radius-${k}: ${v};`)
  }
  // 阴影
  for (const [k, v] of Object.entries(SHADOW)) {
    lines.push(`  --shadow-${k}: ${v};`)
  }
  // 布局
  for (const [k, v] of Object.entries(LAYOUT)) {
    lines.push(`  --layout-${kebab(k)}: ${v}px;`)
  }
  // z-index
  for (const [k, v] of Object.entries(Z_INDEX)) {
    lines.push(`  --z-${k}: ${v};`)
  }
  // 字体
  lines.push(`  --font-family-base: ${FONT_FAMILY.base};`)
  lines.push(`  --font-family-mono: ${FONT_FAMILY.mono};`)
  return lines.join('\n')
}

function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/** 状态色映射 — 用于徽章/标签 */
export const STATUS_COLORS: Record<string, { bg: string; fg: string; border?: string }> = {
  ok:      { bg: '#f6ffed', fg: '#52c41a', border: '#b7eb8f' },
  ready:   { bg: '#f6ffed', fg: '#52c41a', border: '#b7eb8f' },
  done:    { bg: '#f6ffed', fg: '#52c41a', border: '#b7eb8f' },
  success: { bg: '#f6ffed', fg: '#52c41a', border: '#b7eb8f' },
  pending: { bg: '#fffbe6', fg: '#faad14', border: '#ffe58f' },
  warning: { bg: '#fffbe6', fg: '#faad14', border: '#ffe58f' },
  error:   { bg: '#fff1f0', fg: '#ff4d4f', border: '#ffa39e' },
  danger:  { bg: '#fff1f0', fg: '#ff4d4f', border: '#ffa39e' },
  failed:  { bg: '#fff1f0', fg: '#ff4d4f', border: '#ffa39e' },
  info:    { bg: '#e6f4ff', fg: '#1677ff', border: '#91caff' },
  queued:  { bg: '#f0f1f3', fg: '#4e5969', border: '#e5e7eb' },
  converting: { bg: '#e6f4ff', fg: '#1677ff', border: '#91caff' },
}

// 模型：claude-sonnet-4-6
// (existing COLORS / FONT_SIZES / etc. above remain unchanged for Phase 0)
// Below: thin re-export from primitives to make them available to TS consumers
// Phase 0: primitives layer added; Phase 1.A will deprecate COLORS hex values
//          and migrate all consumers to PRIMITIVES['blue'][6] / primitivesToCSSVars()

export { PRIMITIVES, primitivesToCSSVars, SCALE_NAMES } from './primitives'
export type { ScaleName } from './primitives'