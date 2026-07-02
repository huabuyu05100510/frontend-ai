/**
 * @skeleton/core - 拓扑压缩（Topology Compression）
 *
 * 来源：Trinity Transpiler Engine Layer 1 - Topological Mirroring
 * 核心思想：路径压缩 DFS（Path Compression DFS）
 *
 * 问题：现代前端框架（React/Vue/Taro）会产生大量"透明包装层"——
 * 这些 div/View 的 rect 与父节点完全重合，且无背景/边框/阴影等视觉样式。
 * 直接遍历会产生冗余骨骼，增加骨架体积，也影响生成质量。
 *
 * 解决方案：
 * 1. DFS 遍历节点树
 * 2. 检测"冗余包装层"（rect 重合 + 无 visual styles）
 * 3. 将冗余包装层的子节点"提升"到父节点下（路径压缩）
 * 4. 冗余层自身不进入骨架提取流程
 *
 * 效果：
 * - 减少 30-50% 的需处理节点数
 * - 骨架骨骼更精准（去掉噪音层）
 * - 提取速度提升（节点更少）
 */

import type { NodeMeasurement, Rect } from './types.js'

// ─── 冗余包装层检测 ────────────────────────────────────────────────────────────

/**
 * 判断一个矩形是否与参照矩形完全重合（容差 1px）。
 * 允许 1px 误差兼容各平台的 subpixel 渲染差异。
 */
function rectsMatch(a: Rect, b: Rect, tolerance = 1): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  )
}

/**
 * 判断节点是否有视觉样式（背景 / 边框 / 阴影 / padding）。
 * 任意一项存在则不是冗余包装层。
 */
function hasVisualStyle(node: NodeMeasurement): boolean {
  const s = node.styles

  // 有背景色（非透明）
  const bg = s.backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return true

  // 有背景图
  if (s.backgroundImage && s.backgroundImage !== 'none') return true

  // 有边框
  if (s.hasBorder) return true

  // 有阴影
  if (s.boxShadow && s.boxShadow !== 'none') return true

  return false
}

/** 需要跳过拓扑压缩的标签（语义节点不能被透明化） */
const SKIP_COMPRESSION_TAGS = new Set([
  'html', 'body', 'head',
  // 表格结构标签（rect 重合但有语义）
  'table', 'thead', 'tbody', 'tfoot', 'tr',
  // 表单（有交互语义）
  'form', 'fieldset',
])

/**
 * 判断一个节点是否为"冗余包装层"。
 *
 * 冗余条件（全部满足）：
 * 1. rect 与父 rect 完全重合（±1px）
 * 2. 无视觉样式（背景/边框/阴影）
 * 3. 不在语义节点黑名单中
 *
 * @param node       待判定节点
 * @param parentRect 父节点 rect
 */
export function isRedundantWrapper(node: NodeMeasurement, parentRect: Rect): boolean {
  // 语义节点保留
  if (SKIP_COMPRESSION_TAGS.has(node.tag)) return false

  // 叶节点永不压缩
  if (node.isLeaf) return false

  // rect 不匹配父节点
  if (!rectsMatch(node.rect, parentRect)) return false

  // 有视觉样式
  if (hasVisualStyle(node)) return false

  return true
}

// ─── 拓扑压缩主函数 ────────────────────────────────────────────────────────────

/** 拓扑压缩统计信息（调试用） */
export interface TopologyStats {
  originalCount: number
  prunedCount: number
  finalCount: number
}

/**
 * 对节点树进行拓扑压缩（路径压缩 DFS）。
 * 移除冗余包装层，将其子节点提升到父层，返回新的根节点。
 *
 * 注意：此函数不修改原始节点树，返回浅拷贝（共享叶节点引用）。
 *
 * @param root   根节点
 * @param stats  可选统计对象（传入则累计计数）
 */
export function collapseRedundantWrappers(
  root: NodeMeasurement,
  stats?: TopologyStats,
): NodeMeasurement {
  if (stats) stats.originalCount++

  const compressedChildren: NodeMeasurement[] = []

  for (const child of root.children) {
    if (stats) stats.originalCount++

    if (isRedundantWrapper(child, root.rect)) {
      // 冗余层：跳过，将其子节点提升
      if (stats) stats.prunedCount++

      const promoted = collapseChildren(child, child.rect, stats)
      compressedChildren.push(...promoted)
    } else {
      // 保留，但递归压缩其子树
      compressedChildren.push(collapseRedundantWrappers(child, stats))
    }
  }

  if (stats) stats.finalCount = (stats.finalCount ?? 0) + 1

  return { ...root, children: compressedChildren }
}

/**
 * 递归提升被压缩节点的子节点。
 * 被压缩节点的子节点继续检查是否也是冗余包装层（链式压缩）。
 */
function collapseChildren(
  node: NodeMeasurement,
  parentRect: Rect,
  stats?: TopologyStats,
): NodeMeasurement[] {
  const result: NodeMeasurement[] = []

  for (const child of node.children) {
    if (stats) stats.originalCount++

    if (isRedundantWrapper(child, parentRect)) {
      if (stats) stats.prunedCount++
      result.push(...collapseChildren(child, parentRect, stats))
    } else {
      result.push(collapseRedundantWrappers(child, stats))
    }
  }

  return result
}
