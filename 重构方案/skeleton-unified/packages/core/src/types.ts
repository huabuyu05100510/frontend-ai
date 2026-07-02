/**
 * @skeleton/core - 统一类型系统
 *
 * 坐标系规范：所有坐标均为相对容器的百分比
 *   x = left / containerWidth * 100
 *   y = top  / containerHeight * 100
 *   w = width / containerWidth * 100
 *   h = height / containerHeight * 100
 *
 * 容器宽高比 aspectRatio = capturedWidth / capturedHeight
 * 渲染时用 aspectRatio 撑开容器高度，骨架按百分比叠加，任意尺寸下等比缩放。
 */

// ─── 核心骨骼类型 ──────────────────────────────────────────────────────────────

/** 单条骨架骨骼 - 全百分比坐标 */
export interface Bone {
  /** 左边距占容器宽度的百分比 */
  x: number
  /** 顶边距占容器高度的百分比 */
  y: number
  /** 宽度占容器宽度的百分比 */
  w: number
  /** 高度占容器高度的百分比 */
  h: number
  /**
   * 圆角：
   * - `number` → px 值（渲染时固定不缩放，更接近设计稿视觉）
   * - `'50%'` → 圆形（正方形骨骼）
   */
  r?: number | string
  /**
   * 最小宽度占容器宽度百分比。
   * 固定宽度元素：minW === maxW === w，防止响应式缩放时宽度改变。
   */
  minW?: number
  /** 最大宽度占容器宽度百分比 */
  maxW?: number
  /** 最小高度占容器高度百分比 */
  minH?: number
  /** 最大高度占容器高度百分比 */
  maxH?: number
  /**
   * 容器背景骨架标记。
   * `true` 时渲染颜色较浅，子骨骼叠于其上形成对比层次感。
   * Web 渲染器跳过其本身的 shimmer 动画。
   */
  c?: boolean
}

/**
 * 紧凑存储格式（JSON 体积优化，约减少 40%）。
 *
 * 完整格式：[x, y, w, h, r?, c?, minW?, maxW?, minH?, maxH?]
 *
 * 省略规则：
 * - r 缺省为 8（渲染器默认值）
 * - c 缺省为 false
 * - minW/maxW/minH/maxH 不设时省略（数组末尾截断）
 */
export type CompactBone = (number | string | boolean | undefined)[]

/** 输入边界可接受的所有骨骼格式 */
export type AnyBone = Bone | CompactBone

/** 标准化任意格式骨骼为对象格式 */
export function normalizeBone(b: AnyBone): Bone {
  if (!Array.isArray(b)) return b as Bone
  const [x, y, w, h, r, c, minW, maxW, minH, maxH] = b as CompactBone
  const bone: Bone = {
    x: (x as number) ?? 0,
    y: (y as number) ?? 0,
    w: (w as number) ?? 0,
    h: (h as number) ?? 0,
  }
  if (r !== undefined && r !== null) bone.r = r as number | string
  if (c === true) bone.c = true
  if (typeof minW === 'number') bone.minW = minW
  if (typeof maxW === 'number') bone.maxW = maxW
  if (typeof minH === 'number') bone.minH = minH
  if (typeof maxH === 'number') bone.maxH = maxH
  return bone
}

/** 将 Bone 对象转为 CompactBone（去除末尾 undefined） */
export function compactBone(b: Bone): CompactBone {
  const arr: (number | string | boolean | undefined)[] = [
    b.x, b.y, b.w, b.h,
    b.r,
    b.c || undefined,
    b.minW,
    b.maxW,
    b.minH,
    b.maxH,
  ]
  // 截断末尾 undefined
  let end = arr.length - 1
  while (end >= 4 && arr[end] === undefined) end--
  return arr.slice(0, end + 1)
}

// ─── 骨架数据（存储格式）─────────────────────────────────────────────────────

/**
 * 完整骨架数据，由采集器生成，存入 Storage，渲染器读取。
 *
 * @example
 * {
 *   name: 'product-card',
 *   aspectRatio: 1.5,      // 375 / 250
 *   capturedWidth: 375,
 *   bones: [[2.67, 2.4, 94.67, 32], ...],
 *   version: 2
 * }
 */
export interface SkeletonData {
  /** 骨架标识，对应组件名或路由名 */
  name: string
  /**
   * 捕获时容器的宽高比（capturedWidth / capturedHeight）。
   * 渲染时用 `padding-top: 1/aspectRatio * 100%` 或 `aspectRatio` CSS 属性撑高容器。
   */
  aspectRatio: number
  /** 捕获时容器宽度（px）。用于评估 minW/maxW 约束的绝对值精度 */
  capturedWidth: number
  /** 骨骼列表（紧凑格式） */
  bones: CompactBone[]
  /** 格式版本号，当前为 2 */
  version: 2
  /** 捕获时间戳（Unix ms） */
  capturedAt?: number
  /** 来源平台标记，便于 debug */
  platform?: 'web' | 'rn' | 'taro-mp' | 'taro-h5'
}

/** 多断点响应式骨架（key = 视口最小宽度 px） */
export interface ResponsiveSkeletonData {
  breakpoints: Record<number, SkeletonData>
}

// ─── 平台测量结果（Adapter 输出）────────────────────────────────────────────

/** 节点位置（绝对像素，相对于视口或自定义原点） */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** 平台适配器归一化的节点样式（各平台差异在 Adapter 层屏蔽） */
export interface NodeStyles {
  /** CSS display 值 */
  display: string
  /** visibility 值 */
  visibility: string
  /** opacity 字符串（"0" 表示不可见） */
  opacity: string
  /** overflow 值 */
  overflow: string
  /** 背景颜色（rgba 格式），透明时为 'rgba(0, 0, 0, 0)' */
  backgroundColor: string
  /** 背景图像（backgroundImage CSS 值），无时为 'none' */
  backgroundImage: string
  /** border-radius CSS 值 */
  borderRadius: string
  /** 是否有可见边框 */
  hasBorder: boolean
  /** 是否为固定宽度元素（flex-shrink:0 或宽度 < 父宽 40%） */
  isFixedWidth: boolean
  /** 是否为固定高度元素 */
  isFixedHeight: boolean
  /** CSS min-width（px，0 表示未设置） */
  minWidth: number
  /** CSS max-width（px，0 表示未设置，Infinity 表示 none） */
  maxWidth: number
  /** CSS min-height（px） */
  minHeight: number
  /** CSS max-height（px） */
  maxHeight: number
  /** box-shadow 值（非 'none' 时认为有视觉表面） */
  boxShadow: string
}

/**
 * 平台归一化的节点测量结果。
 * 由各平台 Adapter 产出，作为 extractBones 的输入。
 */
export interface NodeMeasurement {
  /** 节点唯一 ID（调试用） */
  id: string
  /** 原始标签名（小写），如 'div' / 'View' / 'text' */
  tag: string
  /** 节点位置（绝对像素） */
  rect: Rect
  /** 归一化样式信息 */
  styles: NodeStyles
  /** 子节点（已经过可见性过滤） */
  children: NodeMeasurement[]
  /**
   * 是否为叶节点。
   * Adapter 根据平台特征预判定（文本/媒体/无子节点/枚举标签等）。
   * extractBones 直接使用，不重复检测。
   */
  isLeaf: boolean
  /** 叶节点文本内容（layout 引擎折行用） */
  textContent?: string
}

// ─── 描述符驱动布局（SSR/构建期路径）────────────────────────────────────────

/**
 * 骨架描述符 - 无 DOM 情况下描述组件结构。
 * 可手动编写或由 fromElement() 自动提取。
 * computeLayout() 使用此描述符在任意宽度下计算骨架。
 *
 * @example
 * const card: SkeletonDescriptor = {
 *   display: 'flex', flexDirection: 'column', padding: 16, gap: 12,
 *   children: [
 *     { aspectRatio: 16/9 },
 *     { text: 'Title text here', font: '700 18px Inter', lineHeight: 24 },
 *     { height: 44, borderRadius: 8 },
 *   ]
 * }
 */
export interface SkeletonDescriptor {
  display?: 'block' | 'flex'
  flexDirection?: 'row' | 'column'
  alignItems?: string
  justifyContent?: string
  /** 显式宽度（px），仅用于固定尺寸子节点 */
  width?: number
  /** 显式高度（px） */
  height?: number
  /** CSS aspect-ratio 数值（如 16/9 = 1.778） */
  aspectRatio?: number
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number }
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number }
  gap?: number
  rowGap?: number
  columnGap?: number
  borderRadius?: number | string
  /** CSS font 字符串，用于文字折行预计算（如 '700 18px Inter'） */
  font?: string
  /** 行高（px） */
  lineHeight?: number
  /** 文字内容，编译期预计算自然宽度 */
  text?: string
  /** 最大宽度约束（px） */
  maxWidth?: number
  /** 强制标记为叶节点 */
  leaf?: boolean
  children?: SkeletonDescriptor[]
}

export type ResponsiveDescriptor = Record<number, SkeletonDescriptor>

// ─── 平台适配器接口 ────────────────────────────────────────────────────────────

/** 分片调度器接口（各平台实现） */
export interface Scheduler {
  /**
   * 调度一个工作单元。
   * @param work 工作函数，返回 `true` 表示本批次完成可继续，`false` 表示全部完成
   */
  schedule(work: (batchSize: number) => boolean): void
  /** 取消所有待执行工作 */
  cancel(): void
}

/** 存储适配器接口（各平台实现） */
export interface Storage {
  get(key: string): Promise<SkeletonData | null>
  set(key: string, data: SkeletonData): Promise<void>
  remove(key: string): Promise<void>
}

/** 平台适配器接口 */
export interface PlatformAdapter {
  /**
   * 测量目标根节点及其子树，返回归一化的测量树。
   * @param root 平台原生节点引用（Web: Element，RN: ViewRef，Taro: string selector）
   */
  measure(root: unknown): Promise<NodeMeasurement>
  /** 创建该平台的调度器实例 */
  createScheduler(): Scheduler
  /** 创建该平台的存储实例 */
  createStorage(): Storage
}

// ─── 提取配置 ─────────────────────────────────────────────────────────────────

export interface ExtractConfig {
  /** 最小捕获宽度（px，绝对值），低于此值的节点忽略。默认 4 */
  minW?: number
  /** 最小捕获高度（px，绝对值），低于此值的节点忽略。默认 4 */
  minH?: number
  /**
   * 固定宽度判定阈值（0~1）。
   * 当元素宽度 < 容器宽度 * threshold 时，视为固定宽元素，设 minW===maxW。
   * 默认 0.4（宽度小于父宽 40%）
   */
  fixedWidthThreshold?: number
  /**
   * 是否启用拓扑压缩（移除 rect 完全重合父节点且无 visual styles 的冗余包装层）。
   * 默认 true
   */
  topologyCompression?: boolean
  /**
   * 是否捕获有圆角边框的容器（无背景但有 border + border-radius）。
   * 默认 true（对应 boneyard captureRoundedBorders）
   */
  captureRoundedBorders?: boolean
  /** 强制视为叶节点的 tag 集合（小写），如 ['p','h1','li'] */
  leafTags?: string[]
  /** 排除的 tag 集合（跳过元素及其子树） */
  excludeTags?: string[]
}

// ─── 动画配置 ─────────────────────────────────────────────────────────────────

export type AnimationStyle = 'pulse' | 'shimmer' | 'solid' | false

export interface AnimationConfig {
  style: AnimationStyle
  speed?: string
  color?: string
  darkColor?: string
}
