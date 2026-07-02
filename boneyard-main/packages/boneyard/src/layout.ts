/**
 * 描述符驱动的骨架屏布局引擎。
 *
 * 热路径采用"编译 + 重排"架构：
 * - compileDescriptor() 只做一次冷工作（文本分词、字段解析）
 * - computeLayout() 复用编译好的元数据，只做数值运算
 *
 * 这样在不同宽度下反复重排时成本极低，
 * 也避免了每次都重新准备文本节点。
 */

import {
  layout as pretextLayout,      // 按宽度折行并返回实际高度
  prepareWithSegments,           // 对文本分词，生成折行所需的段落数据
  walkLineRanges,                // 遍历每一行，用于计算文字自然宽度
  type PreparedTextWithSegments, // 分词结果的类型
} from '@chenglou/pretext'
import type { SkeletonDescriptor, Bone, SkeletonResult } from './types.js'

/** 已解析的 padding / margin —— 始终包含四条边 */
interface Sides { top: number; right: number; bottom: number; left: number }

// 单个节点的布局结果：节点自身总高度 + 生成的骨架列表
type LayoutFragment = {
  height: number  // 节点占据的总高度（含 margin）
  bones: Bone[]   // 该节点及其子树产生的所有骨架
}

// 编译阶段预处理好的文本指标，避免每次布局重复分词
type CompiledTextMetrics = {
  prepared: PreparedTextWithSegments // 分词结果，供折行计算复用
  intrinsicWidth: number             // 文字在无限宽下的自然宽（含左右 padding）
  singleLineThreshold: number        // 低于此高度视为单行，骨架宽度收缩到文字宽
  lineHeight: number                 // 行高（px），传给折行函数
}

// 编译后的描述符，含所有预处理好的字段和按宽度分组的布局缓存
export interface CompiledSkeletonDescriptor {
  readonly __compiled: true                          // 类型标记，用于运行时区分是否已编译
  readonly source: SkeletonDescriptor                // 原始描述符引用，用于指纹对比
  readonly sourceFingerprint: string                 // 源数据的序列化指纹，变更时触发重编译
  readonly padding: Sides                            // 已解析为四边数字的 padding
  readonly margin: Sides                             // 已解析为四边数字的 margin
  readonly display: 'block' | 'flex'                 // 布局模式，默认 block
  readonly flexDirection: 'row' | 'column'           // flex 方向，默认 row
  readonly width?: number                            // 显式宽度（px），未定义则撑满可用宽
  readonly height?: number                           // 显式高度（px），叶节点使用
  readonly aspectRatio?: number                      // 宽高比，叶节点使用（如 16/9 图片）
  readonly maxWidth?: number                         // 最大宽度限制
  readonly borderRadius?: number | string            // 圆角，默认 8
  readonly leaf: boolean                             // 是否为叶节点（直接生成一条骨架）
  readonly contentSized: boolean                     // 宽度由内容决定（文本/leaf 且无显式 width）
  readonly children: CompiledSkeletonDescriptor[]    // 已递归编译好的子节点列表
  readonly textMetrics?: CompiledTextMetrics         // 文本节点才有，非文本为 undefined
  layoutCache: Map<number, LayoutFragment>           // 按归一化宽度缓存布局结果，可写（缓存填充）
}

// 模块级编译缓存：WeakMap 保证描述符对象被 GC 时缓存条目自动释放，不会内存泄漏
const compiledDescriptorCache = new WeakMap<SkeletonDescriptor, CompiledSkeletonDescriptor>()

// 将 padding/margin 的多种写法统一转成四边对象
// undefined → 全 0；number → 四边相同；Partial<Sides> → 缺失字段补 0
function resolveSides(v: number | Partial<Sides> | undefined): Sides {
  if (v === undefined) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof v === 'number') return { top: v, right: v, bottom: v, left: v }
  return { top: v.top ?? 0, right: v.right ?? 0, bottom: v.bottom ?? 0, left: v.left ?? 0 }
}

// 类型守卫：通过检查 __compiled 标记判断是否已编译
// 避免重复编译，也用于提取 .source 原始描述符
function isCompiledDescriptor(
  value: SkeletonDescriptor | CompiledSkeletonDescriptor,
): value is CompiledSkeletonDescriptor {
  return (value as CompiledSkeletonDescriptor).__compiled === true
}

// 判断描述符是否为叶节点（直接渲染成一条骨架，不递归子节点）
function isLeaf(desc: SkeletonDescriptor): boolean {
  if (desc.leaf === true) return true                                                          // 显式声明为叶节点
  if (desc.text !== undefined) return true                                                     // 有文字内容，视为叶节点
  if (desc.height !== undefined && (!desc.children || desc.children.length === 0)) return true // 有显式高度且无子节点
  if (desc.aspectRatio !== undefined && (!desc.children || desc.children.length === 0)) return true // 有宽高比且无子节点
  return false
}

// 计算文字在无限宽下的自然宽度（即最长一行的宽度）
// 传入 MAX_SAFE_INTEGER 让所有文字都排在一行，再取最宽行
function getIntrinsicTextWidth(prepared: PreparedTextWithSegments): number {
  let intrinsicWidth = 0
  walkLineRanges(prepared, Number.MAX_SAFE_INTEGER, line => {
    if (line.width > intrinsicWidth) intrinsicWidth = line.width // 逐行比较，取最大值
  })
  return intrinsicWidth
}

// 将 padding/margin 序列化为 "top,right,bottom,left" 字符串，用于指纹计算
function fingerprintSides(v: number | Partial<Sides> | undefined): string {
  const resolved = resolveSides(v)
  return `${resolved.top},${resolved.right},${resolved.bottom},${resolved.left}`
}

// 将任意字段值序列化为字符串；undefined 显式转为空字符串，与 JSON.stringify 不同（不会跳过）
function fingerprintValue(value: unknown): string {
  if (value === undefined) return ''
  return String(value)
}

// 将描述符的所有字段（含子节点）序列化为一个字符串指纹
// 用于检测源数据是否被修改，从而决定是否需要重新编译
function fingerprintDescriptor(desc: SkeletonDescriptor): string {
  const children = desc.children ?? [] // 子节点不存在时视为空数组
  return [
    fingerprintValue(desc.display ?? 'block'),         // 布局模式
    fingerprintValue(desc.flexDirection ?? 'row'),      // flex 方向
    fingerprintValue(desc.alignItems),                  // 交叉轴对齐
    fingerprintValue(desc.justifyContent),              // 主轴对齐
    fingerprintValue(desc.width),                       // 显式宽度
    fingerprintValue(desc.height),                      // 显式高度
    fingerprintValue(desc.aspectRatio),                 // 宽高比
    fingerprintSides(desc.padding),                     // 四边 padding
    fingerprintSides(desc.margin),                      // 四边 margin
    fingerprintValue(desc.gap),                         // 通用间距
    fingerprintValue(desc.rowGap),                      // 行间距（flex-column）
    fingerprintValue(desc.columnGap),                   // 列间距（flex-row）
    fingerprintValue(desc.borderRadius),                // 圆角
    fingerprintValue(desc.font),                        // 字体（文本节点）
    fingerprintValue(desc.lineHeight),                  // 行高（文本节点）
    fingerprintValue(desc.text),                        // 文字内容
    fingerprintValue(desc.maxWidth),                    // 最大宽度
    fingerprintValue(desc.leaf),                        // 是否强制叶节点
    `${children.length}[${children.map(fingerprintDescriptor).join('|')}]`, // 子节点数量 + 递归指纹
  ].join('::') // 用 '::' 分隔字段，降低不同字段组合碰撞的概率
}

// 对已编译的描述符做新鲜度检查：若源数据指纹未变则直接复用，否则重新编译
function ensureFreshCompiled(
  desc: CompiledSkeletonDescriptor,
): CompiledSkeletonDescriptor {
  const nextFingerprint = fingerprintDescriptor(desc.source) // 重新计算源数据当前指纹
  if (nextFingerprint === desc.sourceFingerprint) return desc // 指纹未变，缓存有效
  return compileDescriptor(desc.source)                       // 指纹变了，用原始描述符重新编译
}

/**
 * 将描述符编译成带文本指标缓存和按宽度布局缓存的编译树。
 * 若源描述符后续被修改，下次调用时会自动重建编译树。
 */
export function compileDescriptor(
  desc: SkeletonDescriptor | CompiledSkeletonDescriptor,
): CompiledSkeletonDescriptor {
  // 若传入的已经是编译态，做新鲜度检查后直接返回（或重编译）
  if (isCompiledDescriptor(desc)) return ensureFreshCompiled(desc)

  // 查 WeakMap 编译缓存
  const cached = compiledDescriptorCache.get(desc)
  if (cached) {
    const nextFingerprint = fingerprintDescriptor(desc) // 检查源数据是否被修改
    if (cached.sourceFingerprint === nextFingerprint) return cached // 未变，直接返回缓存
  }

  // 缓存未命中或已失效，重新编译
  const sourceFingerprint = fingerprintDescriptor(desc) // 记录当前指纹，用于后续失效检测
  const padding = resolveSides(desc.padding)             // 统一解析 padding 为四边数字
  const margin = resolveSides(desc.margin)               // 统一解析 margin 为四边数字

  // 仅在 text + font + lineHeight 三者同时存在时才准备文本指标（缺一不可）
  const textMetrics =
    desc.text && desc.font && desc.lineHeight
      ? (() => {
          const prepared = prepareWithSegments(desc.text!, desc.font!) // 分词（昂贵操作，只做一次）
          return {
            prepared,
            intrinsicWidth: getIntrinsicTextWidth(prepared) + padding.left + padding.right, // 自然宽加上左右 padding
            singleLineThreshold: desc.lineHeight! * 1.5, // 1.5 倍行高作为"单行判定"阈值，留浮点误差余量
            lineHeight: desc.lineHeight!,
          }
        })()
      : undefined

  const compiled: CompiledSkeletonDescriptor = {
    __compiled: true,                    // 标记为已编译态
    source: desc,                        // 保留原始引用，供后续指纹对比
    sourceFingerprint,                   // 记录编译时的指纹
    padding,                             // 已解析的四边 padding
    margin,                              // 已解析的四边 margin
    display: desc.display ?? 'block',    // 布局模式，默认 block
    flexDirection: desc.flexDirection ?? 'row', // flex 方向，默认 row
    width: desc.width,                   // 显式宽度（可能 undefined）
    height: desc.height,                 // 显式高度（可能 undefined）
    aspectRatio: desc.aspectRatio,       // 宽高比（可能 undefined）
    maxWidth: desc.maxWidth,             // 最大宽度限制（可能 undefined）
    borderRadius: desc.borderRadius,     // 圆角（可能 undefined，渲染时默认 8）
    leaf: isLeaf(desc),                  // 是否为叶节点
    // contentSized：无显式宽度 且（有文本 或 显式声明为 leaf）→ 宽度由内容决定，不参与弹性分配
    contentSized: desc.width === undefined && (textMetrics !== undefined || desc.leaf === true),
    children: (desc.children ?? []).map(child => compileDescriptor(child)), // 递归编译所有子节点
    textMetrics,                         // 文本指标（非文本节点为 undefined）
    layoutCache: new Map(),              // 每个节点独立的按宽度布局缓存，初始为空
  }

  compiledDescriptorCache.set(desc, compiled) // 存入 WeakMap，Key 为原始描述符对象引用
  return compiled
}

/**
 * 显式清除描述符的编译缓存。
 * 大多数场景不需要手动调用（指纹机制会自动检测变更），
 * 仅在需要立即强制重建时使用。
 */
export function invalidateDescriptor(desc: SkeletonDescriptor | CompiledSkeletonDescriptor): void {
  const source = isCompiledDescriptor(desc) ? desc.source : desc // 无论传入哪种形态，都取原始描述符
  compiledDescriptorCache.delete(source)                          // 从 WeakMap 中删除，下次重新编译
}

/**
 * 在给定宽度下计算骨架骨头列表。
 * 传入已编译的描述符可在多次重排时复用冷工作。
 */
export function computeLayout(
  input: SkeletonDescriptor | CompiledSkeletonDescriptor,
  width: number,
  name: string = 'component', // 组件名称，写入返回结果，默认 'component'
): SkeletonResult {
  const compiled = compileDescriptor(input)          // 编译（或复用缓存）
  const fragment = layoutCompiledNode(compiled, width) // 执行布局，返回骨架片段
  const bones = cloneBones(fragment.bones)            // 深拷贝，防止调用方修改污染布局缓存

  // 遍历所有骨架，找到最低的下边界（y + h）作为整体高度
  // 比依赖 fragment.height 更准确，不受嵌套层级累加误差影响
  let maxBottom = 0
  for (const b of bones) {
    const bottom = b.y + b.h
    if (bottom > maxBottom) maxBottom = bottom
  }

  return {
    name,
    viewportWidth: width,    // 布局时的视口宽度
    width,                   // 同上（保留两个字段供不同消费方使用）
    height: round(maxBottom), // 精度修正到 2 位小数
    bones,
  }
}

// 带按宽度缓存的布局入口：相同宽度直接返回缓存结果，整棵子树跳过计算
function layoutCompiledNode(
  desc: CompiledSkeletonDescriptor,
  availableWidth: number,
): LayoutFragment {
  const cacheKey = normalizeWidthKey(availableWidth) // 归一化到 3 位小数，防止浮点碎片导致缓存失效
  const cached = desc.layoutCache.get(cacheKey)
  if (cached) return cached // 命中缓存，直接返回

  const fragment = computeLayoutFragment(desc, cacheKey) // 未命中，计算布局
  desc.layoutCache.set(cacheKey, fragment)               // 存入缓存，下次同宽度复用
  return fragment
}

// 核心布局计算：根据节点类型（叶 / flex-row / flex-column / block）分支处理
function computeLayoutFragment(
  desc: CompiledSkeletonDescriptor,
  availableWidth: number,
): LayoutFragment {
  const pad = desc.padding // 取预编译好的四边 padding，避免每次重新解析
  const mar = desc.margin  // 取预编译好的四边 margin

  // 节点左上角相对于父内容区域原点的偏移（由 margin 决定）
  const nodeX = mar.left
  const nodeY = mar.top

  // 计算节点实际宽度：有显式宽度时取 min(显式宽, 可用宽)，否则撑满可用宽；再用 maxWidth 截断
  const nodeWidth = clampWidth(
    desc.width !== undefined ? Math.min(desc.width, availableWidth) : availableWidth,
    desc.maxWidth,
  )

  // 内容区域左上角（节点左上角 + padding）
  const contentX = nodeX + pad.left
  const contentY = nodeY + pad.top

  // 内容区域宽度（节点宽度减去左右 padding，最小为 0 防负值）
  const contentWidth = Math.max(0, nodeWidth - pad.left - pad.right)

  // ── 叶节点：直接生成一条骨架 ──────────────────────────────────────
  if (desc.leaf) {
    const contentHeight = resolveLeafHeight(desc, contentWidth) // 按优先级链计算内容高度
    const totalHeight = contentHeight + pad.top + pad.bottom    // 内容高 + 上下 padding = 节点高
    let boneWidth = nodeWidth                                    // 默认骨架宽度 = 节点宽度

    // 单行文字：骨架宽度收缩到文字自然宽，避免骨架撑满容器显得失真
    if (desc.textMetrics && contentHeight < desc.textMetrics.singleLineThreshold) {
      boneWidth = Math.min(desc.textMetrics.intrinsicWidth, nodeWidth) // 不超过节点宽
    }

    return {
      height: totalHeight + mar.top + mar.bottom, // 对外暴露的总高度含 margin
      bones: [{
        x: round(nodeX),        // 骨架左上角 x（相对父内容区域原点）
        y: round(nodeY),        // 骨架左上角 y
        w: round(boneWidth),    // 骨架宽度
        h: round(totalHeight),  // 骨架高度（不含 margin，margin 只影响占位高度）
        r: desc.borderRadius ?? 8, // 圆角，未指定默认 8px
      }],
    }
  }

  // ── 容器节点：递归布局子节点 ─────────────────────────────────────
  let innerHeight = 0
  let childBones: Bone[] = []

  if (desc.display === 'flex' && desc.flexDirection === 'row') {
    // flex 横排：两遍扫描分配宽度，支持 justify/align
    const row = layoutFlexRow(desc, contentWidth)
    innerHeight = row.height
    childBones = offsetBones(row.bones, contentX, contentY) // 将子骨架从内容坐标系偏移到节点坐标系

  } else if (desc.display === 'flex' && desc.flexDirection === 'column') {
    // flex 纵排：逐行累加高度，支持 gap
    const column = layoutFlexColumn(desc, contentWidth)
    innerHeight = column.height
    childBones = offsetBones(column.bones, contentX, contentY)

  } else {
    // block：从上到下排列，实现外边距折叠
    const block = layoutBlock(desc, contentWidth)
    innerHeight = block.height
    childBones = offsetBones(block.bones, contentX, contentY)
  }

  return {
    height: innerHeight + pad.top + pad.bottom + mar.top + mar.bottom, // 内容高 + 四边间距
    bones: childBones,
  }
}

// block 布局：子节点从上到下排列，实现 CSS 外边距折叠 + 连续文本块最小间距
function layoutBlock(
  parent: CompiledSkeletonDescriptor,
  contentWidth: number,
): LayoutFragment {
  let y = 0              // 当前纵向偏移游标
  let prevMarBottom = 0  // 上一个子节点的 margin-bottom，用于折叠计算
  let prevIsText = false // 上一个子节点是否为文本节点，用于最小间距补偿
  const bones: Bone[] = []

  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]!
    const isText = !!child.textMetrics // 有 textMetrics 即为文本节点

    if (i > 0) {
      // CSS 外边距折叠：相邻两个块级元素的 margin 取较小值重叠（不是相加）
      // y -= min(上个节点的 margin-bottom, 当前节点的 margin-top)
      y -= Math.min(prevMarBottom, child.margin.top)

      // 折叠后的有效间距 = 两个 margin 中较大的那个
      // Ensure minimum visual gap between consecutive text blocks (paragraph spacing)
      const effectiveGap = Math.max(prevMarBottom, child.margin.top)

      // 连续两个文本块之间强制保底 8px 间距，防止骨架视觉粘连
      // 这不是 CSS 标准行为，是骨架屏的视觉补偿
      if (prevIsText && isText && effectiveGap < 8) {
        y += 8 - effectiveGap
      }
    }

    const childFragment = layoutCompiledNode(child, contentWidth) // 递归布局子节点
    bones.push(...offsetBones(childFragment.bones, 0, y))         // 将子骨架垂直偏移到当前 y
    y += childFragment.height                                      // 游标下移子节点总高度
    prevMarBottom = child.margin.bottom                            // 记录本节点 margin-bottom，供下次折叠
    prevIsText = isText                                            // 记录本节点是否文本，供下次间距判断
  }

  return { height: y, bones }
}

// flex 纵向布局：子节点从上到下，支持 rowGap / gap，零高子节点不加间距
function layoutFlexColumn(
  parent: CompiledSkeletonDescriptor,
  contentWidth: number,
): LayoutFragment {
  const gap = parent.source.rowGap ?? parent.source.gap ?? 0 // 优先用 rowGap，其次 gap，默认 0
  let y = 0
  const bones: Bone[] = []

  for (let i = 0; i < parent.children.length; i++) {
    const childFragment = layoutCompiledNode(parent.children[i]!, contentWidth)
    bones.push(...offsetBones(childFragment.bones, 0, y))
    y += childFragment.height
    // 仅非最后一项 且 子节点高度 > 0 时才加 gap（零高节点不产生视觉间距）
    if (i < parent.children.length - 1 && childFragment.height > 0) y += gap
  }

  return { height: y, bones }
}

// flex 横向布局：两遍扫描分配宽度，支持 justify-content / align-items / gap
function layoutFlexRow(
  parent: CompiledSkeletonDescriptor,
  contentWidth: number,
): LayoutFragment {
  // 无子节点直接返回空
  if (parent.children.length === 0) return { height: 0, bones: [] }

  const gap = parent.source.columnGap ?? parent.source.gap ?? 0 // 列间距，优先 columnGap
  const justify = parent.source.justifyContent ?? 'flex-start'  // 主轴对齐，默认 flex-start
  const align = parent.source.alignItems ?? 'stretch'            // 交叉轴对齐，默认 stretch

  // ── 第一遍扫描：收集各子节点宽度，弹性子节点先标记为 -1 ──────────
  const childWidths: number[] = []
  let totalFixed = 0 // 所有固定宽（显式宽 + 内容自适应宽）之和
  let flexCount = 0  // 弹性子节点数量

  for (const child of parent.children) {
    if (child.width !== undefined) {
      // 有显式宽度：直接使用，受 maxWidth 截断
      const width = clampWidth(child.width, child.maxWidth)
      childWidths.push(width)
      totalFixed += width
      continue
    }

    if (child.contentSized) {
      // 内容自适应宽（文本节点 / 无显式宽的 leaf）：取文字自然宽，不参与弹性分配
      const width = clampWidth(getIntrinsicWidth(child, contentWidth), child.maxWidth)
      childWidths.push(width)
      totalFixed += width
      continue
    }

    // 弹性子节点：暂时标记为 -1，第二遍填入实际宽度
    childWidths.push(-1)
    flexCount++
  }

  // 间距总宽 = (子节点数 - 1) * gap
  const totalGaps = Math.max(0, parent.children.length - 1) * gap
  // 剩余空间 = 容器宽 - 固定宽总和 - 间距总宽，最小为 0 防负值
  const remaining = Math.max(0, contentWidth - totalFixed - totalGaps)
  // 每个弹性子节点分得的宽度（等分）
  const flexWidth = flexCount > 0 ? remaining / flexCount : 0

  // ── 第二遍扫描：将弹性子节点的 -1 替换为实际宽度 ────────────────
  for (let i = 0; i < childWidths.length; i++) {
    if (childWidths[i]! < 0) {
      childWidths[i] = clampWidth(flexWidth, parent.children[i]!.maxWidth) // 弹性宽也受 maxWidth 截断
    }
  }

  // 按已确定宽度布局每个子节点
  const childFragments = childWidths.map((width, index) =>
    layoutCompiledNode(parent.children[index]!, width),
  )
  // 行高 = 所有子节点高度的最大值（flex 行的高度由最高的子节点决定）
  const maxHeight = Math.max(0, ...childFragments.map(fragment => fragment.height))
  // 所有子节点实际占用的总宽（含间距）
  const totalUsed = childWidths.reduce((sum, width) => sum + width, 0) + totalGaps

  // ── 计算主轴起始偏移（justify-content） ──────────────────────────
  let xStart = 0   // flex-start 默认从 0 开始
  let extraGap = 0 // space-between 时每个间隙额外增加的宽度

  if (justify === 'flex-end') {
    xStart = Math.max(0, contentWidth - totalUsed)   // 所有子节点靠右排列
  } else if (justify === 'center') {
    xStart = Math.max(0, (contentWidth - totalUsed) / 2) // 整体居中
  } else if (justify === 'space-between' && parent.children.length > 1) {
    // space-between：子节点两端对齐，间距均分剩余空间
    // extraGap = 均分后每个间隙宽度 - 基础 gap（基础 gap 已计入 totalUsed）
    const totalChildWidth = childWidths.reduce((sum, width) => sum + width, 0)
    extraGap = Math.max(0, (contentWidth - totalChildWidth) / (parent.children.length - 1)) - gap
  }

  // ── 放置每个子节点 ────────────────────────────────────────────────
  const bones: Bone[] = []
  let x = xStart // 横向游标，从主轴起始偏移开始

  for (let i = 0; i < childFragments.length; i++) {
    // 计算交叉轴（纵向）偏移（align-items）
    let yOff = 0
    if (align === 'center') yOff = Math.max(0, (maxHeight - childFragments[i]!.height) / 2)      // 垂直居中
    else if (align === 'flex-end') yOff = Math.max(0, maxHeight - childFragments[i]!.height)     // 底部对齐
    // stretch / flex-start：yOff 保持 0

    bones.push(...offsetBones(childFragments[i]!.bones, x, yOff)) // 将子骨架偏移到当前位置
    x += childWidths[i]!                                           // 横向游标右移子节点宽度
    if (i < childFragments.length - 1) x += gap + extraGap        // 非最后一项，加上间距
  }

  return { height: maxHeight, bones }
}

// 叶节点内容高度：按优先级链依次尝试，最终兜底 20px
function resolveLeafHeight(desc: CompiledSkeletonDescriptor, contentWidth: number): number {
  if (desc.textMetrics) {
    // 文本节点：用 pretext 按实际宽度折行，返回真实渲染高度
    return pretextLayout(desc.textMetrics.prepared, contentWidth, desc.textMetrics.lineHeight).height
  }

  if (desc.height !== undefined) {
    // 显式高度：减去上下 padding 得到内容高（最小为 0）
    return Math.max(0, desc.height - desc.padding.top - desc.padding.bottom)
  }

  if (desc.aspectRatio && desc.aspectRatio > 0 && isFinite(desc.aspectRatio)) {
    // 宽高比：由内容宽度推算高度（如 16:9 图片占位）
    return contentWidth / desc.aspectRatio
  }

  return 20 // 兜底默认高度
}

// 获取节点的内容自然宽度，用于 flex-row 中 contentSized 子节点的宽度计算
function getIntrinsicWidth(desc: CompiledSkeletonDescriptor, maxAvailable: number): number {
  if (desc.textMetrics) return Math.min(desc.textMetrics.intrinsicWidth, maxAvailable) // 文字自然宽，不超过可用宽
  if (desc.width !== undefined) return desc.width // 有显式宽度则直接用
  return maxAvailable // 兜底：撑满可用宽
}

// 深拷贝骨架数组，防止调用方修改布局缓存中的引用
function cloneBones(bones: Bone[]): Bone[] {
  return bones.map(bone => ({ ...bone })) // 展开运算符浅拷贝，Bone 是纯数据对象，浅拷贝即深拷贝
}

// 将骨架数组整体偏移 (dx, dy)，返回新数组（永远不修改原数组）
// dx=dy=0 时也要克隆，防止上层拿到布局缓存内部的直接引用
function offsetBones(bones: Bone[], dx: number, dy: number): Bone[] {
  if (dx === 0 && dy === 0) return cloneBones(bones) // 无偏移也克隆，保护缓存引用
  return bones.map(bone => ({
    ...bone,
    x: round(bone.x + dx), // 加偏移后精度修正
    y: round(bone.y + dy),
  }))
}

// 宽度截断：超过 maxWidth 时取 maxWidth
function clampWidth(width: number, maxWidth?: number): number {
  if (maxWidth === undefined) return width      // 无限制直接返回
  return Math.min(width, maxWidth)
}

// 将宽度归一化为布局缓存的 Key：3 位小数精度
// 防止浮点碎片（375.0000001 vs 375.0000002）导致缓存 Key 碎片化、缓存失效
// 非有限数（Infinity / NaN）统一归 0，避免 Map.get(NaN) 永远 undefined
function normalizeWidthKey(width: number): number {
  if (!isFinite(width)) return 0
  return Math.round(width * 1000) / 1000
}

// 骨架坐标精度修正：保留 2 位小数，消除浮点累积误差
// 非有限数（Infinity / NaN）归 0，防止骨架坐标异常
function round(n: number): number {
  if (!isFinite(n)) return 0
  return Math.round(n * 100) / 100
}
