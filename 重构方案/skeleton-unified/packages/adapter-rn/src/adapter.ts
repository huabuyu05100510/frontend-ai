/**
 * @skeleton/adapter-rn - React Native 适配器
 *
 * 设计原则：
 * ✅ 使用稳定 API：View.ref.measure() / onLayout（不依赖 Fiber 私有 API）
 * ✅ 不使用 __internalInstanceHandle / _reactInternals（生产 build 被混淆）
 * ✅ 使用 InteractionManager 调度（不阻塞动画和交互）
 *
 * 工作原理：
 * 用户在目标组件外层包裹 <SkeletonCapture name="xxx" onCapture={...}>
 * SkeletonCapture 遍历 children，为每个 View 注入 onLayout 回调，
 * 等待所有 layout 完成后测量相对位置，构建 NodeMeasurement 树。
 *
 * 局限性（已知）：
 * - 无法感知 ScrollView 内部超出屏幕的内容
 * - FlatList/SectionList 虚拟化列表只能捕获已渲染的项
 * - StyleSheet.absoluteFill 等绝对定位处理较简单
 *
 * 替代方案（更重但更完整）：
 * - 配合 react-native-view-shot 截图后用 image recognition（不在此范围）
 */

import type { NodeMeasurement, NodeStyles, Rect, PlatformAdapter, Scheduler } from '@skeleton/core'
import { createInteractionScheduler } from './scheduler.js'
import { RNStorage } from './storage.js'

// ─── RN 类型声明（避免直接依赖 react-native，保持可选 peer dep）──────────────

interface MeasureResult {
  x: number
  y: number
  width: number
  height: number
  pageX: number
  pageY: number
}

interface ViewRef {
  measure: (cb: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => void
}

// ─── 测量工具函数 ─────────────────────────────────────────────────────────────

/** Promise 化 View.measure() */
export function measureView(ref: ViewRef): Promise<MeasureResult> {
  return new Promise((resolve, reject) => {
    try {
      ref.measure((x, y, width, height, pageX, pageY) => {
        resolve({ x, y, width, height, pageX, pageY })
      })
    } catch (err) {
      reject(err)
    }
  })
}

// ─── 样式归一化 ────────────────────────────────────────────────────────────────

/**
 * 从 RN StyleSheet.flatten() 结果中提取归一化 NodeStyles。
 * RN 没有 CSS，所有样式是 JS 对象。
 */
export function extractRNStyles(
  flatStyle: Record<string, unknown>,
  rect: Rect,
  parentRect: Rect,
): NodeStyles {
  const bg = flatStyle['backgroundColor'] as string | undefined
  const borderRadius = flatStyle['borderRadius'] as number | undefined
  const borderWidth = flatStyle['borderWidth'] as number | undefined
  const flexShrink = flatStyle['flexShrink'] as number | undefined
  const width = flatStyle['width'] as number | string | undefined

  // 固定宽度判定：
  // - flexShrink === 0（明确不收缩）
  // - width 是数字（非 '%'）且 < 父宽 40%
  const isFixedWidth =
    flexShrink === 0 ||
    (typeof width === 'number' && parentRect.width > 0 && width < parentRect.width * 0.4)

  // min/max
  const minW = (flatStyle['minWidth'] as number | undefined) ?? 0
  const maxW = (flatStyle['maxWidth'] as number | undefined) ?? Infinity
  const minH = (flatStyle['minHeight'] as number | undefined) ?? 0
  const maxH = (flatStyle['maxHeight'] as number | undefined) ?? Infinity

  return {
    display: 'flex',  // RN 默认 flex
    visibility: 'visible',
    opacity: String(flatStyle['opacity'] ?? 1),
    overflow: (flatStyle['overflow'] as string) ?? 'hidden',
    backgroundColor: bg ?? 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',  // RN 无 backgroundImage
    borderRadius: borderRadius !== undefined ? `${borderRadius}px` : '0',
    hasBorder: (borderWidth ?? 0) > 0,
    isFixedWidth,
    isFixedHeight: false,
    minWidth: minW,
    maxWidth: maxW,
    minHeight: minH,
    maxHeight: maxH,
    boxShadow: 'none',
  }
}

// ─── SkeletonCaptureNode：单个节点的测量信息 ──────────────────────────────────

export interface CaptureNode {
  tag: string
  ref: ViewRef
  style: Record<string, unknown>
  isLeaf: boolean
  textContent?: string
  children: CaptureNode[]
}

/** 将 CaptureNode 树转换为 NodeMeasurement 树 */
export async function buildMeasurementTree(
  nodes: CaptureNode[],
  rootRect: Rect,
): Promise<NodeMeasurement[]> {
  const results: NodeMeasurement[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    try {
      const measured = await measureView(node.ref)
      const rect: Rect = {
        left: measured.pageX,
        top: measured.pageY,
        width: measured.width,
        height: measured.height,
      }
      const styles = extractRNStyles(node.style, rect, rootRect)
      const children = await buildMeasurementTree(node.children, rootRect)

      results.push({
        id: `rn-${i}`,
        tag: node.tag,
        rect,
        styles,
        children,
        isLeaf: node.isLeaf || children.length === 0,
        textContent: node.textContent,
      })
    } catch {
      // 测量失败的节点跳过（可能是条件渲染导致 ref 失效）
    }
  }

  return results
}

// ─── RN Platform Adapter ──────────────────────────────────────────────────────

/**
 * React Native 平台适配器。
 *
 * 注意：RN 的 measure 是异步且需要有效的 ref，
 * 不能在 constructor 中直接调用，必须在布局完成后（onLayout）使用。
 */
export function createRNAdapter(): PlatformAdapter {
  return {
    async measure(rootRef: unknown): Promise<NodeMeasurement> {
      const ref = rootRef as ViewRef
      const measured = await measureView(ref)

      const rootRect: Rect = {
        left: measured.pageX,
        top: measured.pageY,
        width: measured.width,
        height: measured.height,
      }

      // 基础 root node（子节点需通过 SkeletonCapture HOC 注入）
      return {
        id: 'rn-root',
        tag: 'View',
        rect: rootRect,
        styles: {
          display: 'flex',
          visibility: 'visible',
          opacity: '1',
          overflow: 'hidden',
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
        children: [],
        isLeaf: false,
      }
    },

    createScheduler(): Scheduler {
      return createInteractionScheduler()
    },

    createStorage() {
      return new RNStorage()
    },
  }
}
