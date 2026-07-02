/**
 * @skeleton/core - 核心骨架提取算法
 *
 * 融合三个来源的最优策略：
 *
 * 1. boneyard snapshotBones：
 *    - leafTags 集合（p/h1-h6/li 等语义叶节点）
 *    - 容器背景识别（c:true）
 *    - captureRoundedBorders（白色卡片也被捕获）
 *
 * 2. smarty-skeleton generateSkeleton：
 *    - 枚举 LEAF_TAGS（audio/button/canvas/img/input/pre/svg/a 等）
 *    - getVisibleRect 溢出容器裁剪
 *    - 叶类名匹配（input/btn/button/select）
 *    - 叶 data 属性（data-skeleton-block）
 *
 * 3. Trinity Transpiler：
 *    - 拓扑压缩（冗余包装层移除，已在 topology.ts 实现）
 *
 * 输出：全百分比坐标 Bone[]，由外部调度器分片驱动或同步调用。
 *
 * 坐标体系：
 *   x = (node.left - root.left) / root.width * 100
 *   y = (node.top  - root.top)  / root.height * 100
 *   w = node.width  / root.width  * 100
 *   h = node.height / root.height * 100
 */

import type { Bone, NodeMeasurement, Rect, ExtractConfig } from './types.js'
import { rectToPercent, parseRadius, isTransparent } from './utils.js'
import { collapseRedundantWrappers } from './topology.js'

// ─── 叶节点标签集合 ────────────────────────────────────────────────────────────

/**
 * 媒体/表单元素：无论有无子节点，一律视为叶节点（不递归进入）。
 * 来源：boneyard MEDIA_TAGS + smarty-skeleton 枚举标签
 */
const ATOMIC_LEAF_TAGS = new Set([
  // 媒体
  'img', 'svg', 'video', 'audio', 'canvas', 'picture',
  // 表单（有交互语义）
  'input', 'button', 'textarea', 'select',
  // 代码块（等宽文本块）
  'pre', 'code',
  // 内联媒体
  'iframe', 'embed', 'object',
  // 图标
  'i',
])

/**
 * 语义块级叶节点：虽有子节点，但骨架层面视为整体。
 * 默认集合，可通过 config.leafTags 追加。
 * 来源：boneyard DEFAULT_LEAF_TAGS
 */
const DEFAULT_SEMANTIC_LEAF_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'td', 'th',
  // 表单语义
  'label',
])

// 叶节点类名关键词判定（来源：smarty-skeleton 类名匹配）已移入 Adapter 层。
// @see adapter-web/src/adapter.ts isLeafElement()

// ─── 叶节点判定 ────────────────────────────────────────────────────────────────

/**
 * 判断节点是否为叶节点（不再递归进入子节点，整体作为一条骨骼）。
 *
 * 优先级（高到低）：
 * 1. NodeMeasurement.isLeaf（Adapter 预判定，直接信任）
 * 2. 原子叶节点标签（媒体/表单）
 * 3. 语义叶节点标签（p/h1/li 等）
 * 4. 无子节点
 * 5. 叶节点类名关键词匹配
 * 6. data-skeleton-block 属性
 */
function isLeafNode(node: NodeMeasurement, semanticLeafTags: Set<string>): boolean {
  // Adapter 已判定
  if (node.isLeaf) return true

  // 原子叶节点（无论有无子节点）
  if (ATOMIC_LEAF_TAGS.has(node.tag)) return true

  // 语义叶节点
  if (semanticLeafTags.has(node.tag)) return true

  // 无子节点
  if (node.children.length === 0) return true

  return false
}

// ─── 可见性判定 ────────────────────────────────────────────────────────────────

/**
 * 判断节点是否不可见（应被跳过）。
 * 三种不可见：display:none / visibility:hidden / opacity:0
 */
function isInvisible(node: NodeMeasurement): boolean {
  const s = node.styles
  return (
    s.display === 'none' ||
    s.visibility === 'hidden' ||
    s.opacity === '0'
  )
}

// ─── 视觉表面判定 ──────────────────────────────────────────────────────────────

/**
 * 判断容器节点是否有视觉背景（需要发出容器骨骼 c:true）。
 *
 * 条件（满足任意一项）：
 * - 有背景色（非透明）
 * - 有背景图
 * - 有圆角边框（captureRoundedBorders=true 时）
 */
function hasVisualSurface(node: NodeMeasurement, captureRoundedBorders: boolean): boolean {
  const s = node.styles

  // 有背景色
  if (!isTransparent(s.backgroundColor)) return true

  // 有背景图
  if (s.backgroundImage && s.backgroundImage !== 'none') return true

  // 有圆角 + 有边框（白色卡片模式：border + border-radius，无背景）
  if (captureRoundedBorders && s.hasBorder) {
    const br = parseFloat(s.borderRadius)
    if (br > 0) return true
  }

  return false
}

// ─── 固定尺寸判定 ──────────────────────────────────────────────────────────────

/**
 * 判断节点是否为固定宽度（应设 minW === maxW）。
 *
 * 固定宽度条件（满足任意一项）：
 * 1. 样式层 isFixedWidth（Adapter 已判定：flex-shrink:0）
 * 2. 宽度 < 容器宽度 * threshold（元素明显窄于容器）
 */
function calcFixedConstraints(
  node: NodeMeasurement,
  rootRect: Rect,
  threshold: number,
): { fixedW: boolean; fixedH: boolean } {
  const s = node.styles
  const fixedW = s.isFixedWidth || (node.rect.width < rootRect.width * threshold)
  const fixedH = s.isFixedHeight
  return { fixedW, fixedH }
}

// ─── 核心骨骼生成 ──────────────────────────────────────────────────────────────

/**
 * 将节点 rect + 样式转换为 Bone（全百分比坐标）。
 *
 * @param node     测量节点
 * @param rootRect 根节点 rect（坐标原点）
 * @param fixedW   是否为固定宽度
 * @param fixedH   是否为固定高度
 * @param isContainer 是否为容器骨骼（c:true）
 */
function makeBone(
  node: NodeMeasurement,
  rootRect: Rect,
  fixedW: boolean,
  fixedH: boolean,
  isContainer: boolean,
): Bone {
  const coords = rectToPercent(node.rect, rootRect)
  const s = node.styles

  const bone: Bone = {
    x: coords.x,
    y: coords.y,
    w: coords.w,
    h: coords.h,
  }

  // 圆角
  const r = parseRadius(s.borderRadius, node.rect)
  if (r !== undefined) bone.r = r

  // 容器标记
  if (isContainer) bone.c = true

  // 固定宽度约束（防响应式缩放改变元素宽度）
  if (fixedW) {
    bone.minW = coords.w
    bone.maxW = coords.w
  } else {
    // CSS min-width / max-width 转百分比
    if (s.minWidth > 0) bone.minW = (s.minWidth / rootRect.width) * 100
    if (s.maxWidth > 0 && isFinite(s.maxWidth)) bone.maxW = (s.maxWidth / rootRect.width) * 100
  }

  // 固定高度约束
  if (fixedH) {
    bone.minH = coords.h
    bone.maxH = coords.h
  } else {
    if (s.minHeight > 0) bone.minH = (s.minHeight / rootRect.height) * 100
    if (s.maxHeight > 0 && isFinite(s.maxHeight)) bone.maxH = (s.maxHeight / rootRect.height) * 100
  }

  return bone
}

// ─── DFS 遍历 ──────────────────────────────────────────────────────────────────

function walkNode(
  node: NodeMeasurement,
  rootRect: Rect,
  out: Bone[],
  semanticLeafTags: Set<string>,
  excludeTags: Set<string>,
  cfg: Required<ExtractConfig>,
): void {
  // 排除标签
  if (excludeTags.has(node.tag)) return

  // 不可见
  if (isInvisible(node)) return

  // 太小的节点忽略（绝对像素判定，避免误捕获空节点）
  if (node.rect.width < cfg.minW || node.rect.height < cfg.minH) return

  const { fixedW, fixedH } = calcFixedConstraints(node, rootRect, cfg.fixedWidthThreshold)

  if (isLeafNode(node, semanticLeafTags)) {
    // 叶节点：整体作为一条骨骼
    out.push(makeBone(node, rootRect, fixedW, fixedH, false))
    return
  }

  // 容器节点：有视觉表面则发出容器骨骼
  if (hasVisualSurface(node, cfg.captureRoundedBorders)) {
    out.push(makeBone(node, rootRect, false, false, true))
  }

  // 递归子节点
  for (const child of node.children) {
    walkNode(child, rootRect, out, semanticLeafTags, excludeTags, cfg)
  }
}

// ─── 主入口 ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<ExtractConfig> = {
  minW: 4,
  minH: 4,
  fixedWidthThreshold: 0.4,
  topologyCompression: true,
  captureRoundedBorders: true,
  leafTags: [],
  excludeTags: [],
}

/**
 * 从 NodeMeasurement 树提取骨架骨骼（全百分比坐标）。
 *
 * 这是平台无关的核心算法。各平台 Adapter 负责将原生节点树转换为
 * NodeMeasurement 树，然后调用此函数。
 *
 * @example
 * // Web
 * const tree = await webAdapter.measure(document.querySelector('#app'))
 * const bones = extractBones(tree, { leafTags: ['p', 'h1'] })
 *
 * // RN
 * const tree = await rnAdapter.measure(viewRef)
 * const bones = extractBones(tree)
 *
 * @param root   根节点测量树
 * @param config 提取配置
 * @returns      骨骼列表（全百分比坐标）
 */
export function extractBones(root: NodeMeasurement, config?: ExtractConfig): Bone[] {
  const cfg: Required<ExtractConfig> = { ...DEFAULT_CONFIG, ...config }

  // 步骤 1：拓扑压缩（移除冗余包装层）
  const compressedRoot = cfg.topologyCompression
    ? collapseRedundantWrappers(root)
    : root

  // 步骤 2：构建叶节点标签集合
  const semanticLeafTags = new Set([
    ...DEFAULT_SEMANTIC_LEAF_TAGS,
    ...(cfg.leafTags ?? []),
  ])

  const excludeTags = new Set(cfg.excludeTags ?? [])

  // 步骤 3：DFS 提取（从根节点的子节点开始，不提取根节点本身）
  const bones: Bone[] = []
  const rootRect = compressedRoot.rect

  for (const child of compressedRoot.children) {
    walkNode(child, rootRect, bones, semanticLeafTags, excludeTags, cfg)
  }

  return bones
}

/**
 * 同 extractBones，但包含拓扑压缩统计（调试用）。
 */
export function extractBonesWithStats(
  root: NodeMeasurement,
  config?: ExtractConfig,
): { bones: Bone[]; stats: import('./topology.js').TopologyStats } {
  const cfg: Required<ExtractConfig> = { ...DEFAULT_CONFIG, ...config }

  const stats = { originalCount: 0, prunedCount: 0, finalCount: 0 }
  const compressedRoot = cfg.topologyCompression
    ? collapseRedundantWrappers(root, stats)
    : root

  const semanticLeafTags = new Set([
    ...DEFAULT_SEMANTIC_LEAF_TAGS,
    ...(cfg.leafTags ?? []),
  ])
  const excludeTags = new Set(cfg.excludeTags ?? [])

  const bones: Bone[] = []
  const rootRect = compressedRoot.rect
  for (const child of compressedRoot.children) {
    walkNode(child, rootRect, bones, semanticLeafTags, excludeTags, cfg)
  }

  return { bones, stats }
}

/**
 * 将骨骼列表 + 根节点 rect 打包为 SkeletonData。
 */
export function packSkeletonData(
  bones: Bone[],
  rootRect: Rect,
  name: string,
  platform: 'web' | 'rn' | 'taro-mp' | 'taro-h5' = 'web',
): import('./types.js').SkeletonData {
  return {
    name,
    aspectRatio: rootRect.width > 0 && rootRect.height > 0
      ? Math.round((rootRect.width / rootRect.height) * 1000) / 1000
      : 1,
    capturedWidth: Math.round(rootRect.width),
    bones: bones.map(b => {
      const arr: (number | string | boolean | undefined)[] = [
        b.x, b.y, b.w, b.h,
        b.r,
        b.c || undefined,
        b.minW,
        b.maxW,
        b.minH,
        b.maxH,
      ]
      let end = arr.length - 1
      while (end >= 4 && arr[end] === undefined) end--
      return arr.slice(0, end + 1)
    }),
    version: 2,
    capturedAt: Date.now(),
    platform,
  }
}
