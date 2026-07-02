/**
 * @skeleton/adapter-web - 浏览器 DOM 适配器
 *
 * 将浏览器 DOM 树转换为 @skeleton/core 的 NodeMeasurement 树。
 *
 * 核心工作：
 * 1. getBoundingClientRect() 获取节点矩形（绝对像素）
 * 2. getComputedStyle() 获取归一化样式
 * 3. 叶节点判定（结合标签、子节点数量、样式）
 * 4. 固定宽度判定（flex-shrink:0 或宽度 < 父宽 40%）
 * 5. 可见性过滤（display:none/visibility:hidden/opacity:0）
 * 6. 溢出容器可见区域裁剪（从 smarty-skeleton getVisibleRect 移植）
 *
 * 来源整合：
 * - boneyard extract.ts: isLeafElement / isFixedSize / parseBorderRadius
 * - smarty-skeleton generateSkeleton.ts: getVisibleRect / 枚举叶节点标签
 * - Trinity trinity-core.ts: hasVisualStyles
 */

import type { NodeMeasurement, NodeStyles, Rect, PlatformAdapter } from '@skeleton/core'
import { createRICScheduler } from '@skeleton/core'
import { WebStorage } from './storage.js'

// ─── 叶节点标签集合 ────────────────────────────────────────────────────────────

/** 原子叶节点：无论有无子节点，整体作为叶 */
const ATOMIC_LEAF_TAGS = new Set([
  'img', 'svg', 'video', 'audio', 'canvas', 'picture',
  'input', 'button', 'textarea', 'select',
  'pre', 'code', 'iframe', 'embed', 'object', 'i',
])

/** 语义叶节点：虽有子节点但视为叶 */
const SEMANTIC_LEAF_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'td', 'th', 'label', 'a',
])

// ─── 可见区域裁剪（from smarty-skeleton getVisibleRect）────────────────────────

/**
 * 沿 parentElement 向上查找 overflow:hidden/auto/scroll 的容器，
 * 将节点 rect 与容器可见区域做交叉裁剪。
 *
 * 解决问题：overflow:hidden 容器内超出部分会被截断，
 * 骨架应只包含可见部分，否则会渲染到容器外。
 *
 * @param rect 节点原始 rect（视口坐标）
 * @param el   节点 DOM Element
 * @returns    裁剪后的 rect（可见区域）
 */
function getVisibleRect(rect: DOMRect, el: Element): Rect {
  let clippedLeft = rect.left
  let clippedTop = rect.top
  let clippedRight = rect.right
  let clippedBottom = rect.bottom

  let parent = el.parentElement
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent)
    const overflow = style.overflow
    const overflowX = style.overflowX
    const overflowY = style.overflowY

    const clipX = overflowX === 'hidden' || overflowX === 'scroll' || overflowX === 'auto' || overflow === 'hidden'
    const clipY = overflowY === 'hidden' || overflowY === 'scroll' || overflowY === 'auto' || overflow === 'hidden'

    if (clipX || clipY) {
      const containerRect = parent.getBoundingClientRect()
      if (clipX) {
        clippedLeft = Math.max(clippedLeft, containerRect.left)
        clippedRight = Math.min(clippedRight, containerRect.right)
      }
      if (clipY) {
        clippedTop = Math.max(clippedTop, containerRect.top)
        clippedBottom = Math.min(clippedBottom, containerRect.bottom)
      }
    }

    parent = parent.parentElement
  }

  return {
    left: clippedLeft,
    top: clippedTop,
    width: Math.max(0, clippedRight - clippedLeft),
    height: Math.max(0, clippedBottom - clippedTop),
  }
}

// ─── 固定尺寸判定（from boneyard isFixedSize）────────────────────────────────

/**
 * 判断元素是否为固定宽度（不参与响应式伸缩）。
 *
 * 条件（满足任意）：
 * - flex-grow > 0：弹性伸展，非固定
 * - flex-shrink === '0'：明确固定（shrink-0）
 * - 在 flex-row 父容器中：只有 flex-shrink:0 才算固定
 * - 块级元素且宽度 < 父宽 80%（有显式宽度）
 */
function isFixedSize(el: Element, style: CSSStyleDeclaration, w: number, parentW: number): boolean {
  if (parseFloat(style.flexGrow) > 0) return false
  if (style.flexShrink === '0') return true

  const parent = el.parentElement
  if (parent) {
    const ps = getComputedStyle(parent)
    const parentIsFlex = ps.display === 'flex' || ps.display === 'inline-flex'
    const parentIsRow = parentIsFlex && !ps.flexDirection.startsWith('column')
    if (parentIsRow) return false
  }

  return w > 0 && parentW > 0 && w < parentW * 0.8
}

// ─── 叶节点判定 ────────────────────────────────────────────────────────────────

function isLeafElement(el: Element, style: CSSStyleDeclaration): boolean {
  const tag = el.tagName.toLowerCase()

  // 原子叶节点标签
  if (ATOMIC_LEAF_TAGS.has(tag)) return true

  // 语义叶节点标签
  if (SEMANTIC_LEAF_TAGS.has(tag)) return true

  // 无子节点
  if (el.children.length === 0) return true

  // 有背景图且无实质性子节点（背景图容器）
  if (
    style.backgroundImage !== 'none' &&
    !el.querySelector('*:not(br)')
  ) return true

  // data-skeleton-block 属性
  if (el.hasAttribute('data-skeleton-block')) return true

  return false
}

// ─── 样式提取 ─────────────────────────────────────────────────────────────────

function extractStyles(
  el: Element,
  style: CSSStyleDeclaration,
  rect: Rect,
  parentRect: Rect,
): NodeStyles {
  const bg = style.backgroundColor
  const isFixed = isFixedSize(el, style, rect.width, parentRect.width)

  // 边框检测
  const borderTop = parseFloat(style.borderTopWidth) || 0
  const hasBorder = borderTop > 0 &&
    style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
    style.borderTopColor !== 'transparent'

  // min/max 尺寸
  const minWidthRaw = parseFloat(style.minWidth) || 0
  const maxWidthRaw = style.maxWidth === 'none' ? Infinity : (parseFloat(style.maxWidth) || 0)
  const minHeightRaw = parseFloat(style.minHeight) || 0
  const maxHeightRaw = style.maxHeight === 'none' ? Infinity : (parseFloat(style.maxHeight) || 0)

  return {
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    overflow: style.overflow,
    backgroundColor: bg,
    backgroundImage: style.backgroundImage,
    borderRadius: style.borderRadius,
    hasBorder,
    isFixedWidth: isFixed,
    isFixedHeight: false, // Web 一般不判定固定高度（高度由内容撑开）
    minWidth: minWidthRaw,
    maxWidth: maxWidthRaw,
    minHeight: minHeightRaw,
    maxHeight: maxHeightRaw,
    boxShadow: style.boxShadow,
  }
}

// ─── 递归测量主函数 ────────────────────────────────────────────────────────────

let nodeCounter = 0

function measureElement(
  el: Element,
  parentRect: Rect,
  rootLeft: number,
  rootTop: number,
): NodeMeasurement | null {
  const style = getComputedStyle(el)

  // 可见性检查
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return null
  }

  const rawRect = el.getBoundingClientRect()
  const rect = getVisibleRect(rawRect, el)

  // 相对于视口的坐标（不转百分比，由 extractBones 做坐标转换）
  const nodeRect: Rect = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }

  const tag = el.tagName.toLowerCase()
  const styles = extractStyles(el, style, nodeRect, parentRect)
  const leaf = isLeafElement(el, style)

  // 过滤不可见的子节点
  const children: NodeMeasurement[] = []
  if (!leaf) {
    for (const child of el.children) {
      const childNode = measureElement(child, nodeRect, rootLeft, rootTop)
      if (childNode) children.push(childNode)
    }
  }

  return {
    id: `web-${++nodeCounter}`,
    tag,
    rect: nodeRect,
    styles,
    children,
    isLeaf: leaf || children.length === 0,
    textContent: leaf ? (el.textContent?.trim() || undefined) : undefined,
  }
}

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 测量 DOM 元素，返回 NodeMeasurement 树。
 *
 * @example
 * import { measureDOM } from '@skeleton/adapter-web'
 * const tree = await measureDOM(document.querySelector('#app'))
 * const bones = extractBones(tree)
 */
export async function measureDOM(root: Element): Promise<NodeMeasurement> {
  nodeCounter = 0
  const rootRect = root.getBoundingClientRect()

  const rootNode: Rect = {
    left: rootRect.left,
    top: rootRect.top,
    width: rootRect.width,
    height: rootRect.height,
  }

  const children: NodeMeasurement[] = []
  for (const child of root.children) {
    const node = measureElement(child, rootNode, rootRect.left, rootRect.top)
    if (node) children.push(node)
  }

  return {
    id: 'web-root',
    tag: root.tagName.toLowerCase(),
    rect: rootNode,
    styles: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflow: 'visible',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      borderRadius: '0',
      hasBorder: false,
      isFixedWidth: false,
      isFixedHeight: false,
      minWidth: 0,
      maxWidth: Infinity,
      minHeight: 0,
      maxHeight: Infinity,
      boxShadow: 'none',
    },
    children,
    isLeaf: false,
  }
}

/**
 * Web 平台适配器（实现 PlatformAdapter 接口）。
 *
 * @example
 * import { webAdapter } from '@skeleton/adapter-web'
 * const tree = await webAdapter.measure(document.querySelector('#card'))
 */
export const webAdapter: PlatformAdapter = {
  measure: (root: unknown) => measureDOM(root as Element),
  createScheduler: createRICScheduler,
  createStorage: () => new WebStorage(),
}
