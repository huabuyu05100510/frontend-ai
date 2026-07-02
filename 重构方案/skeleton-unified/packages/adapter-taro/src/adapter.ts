/**
 * @skeleton/adapter-taro - Taro 跨端适配器
 *
 * Taro 同时支持 H5 和微信小程序，两端测量 API 不同：
 *
 * H5 端：Taro 最终编译为 React，可直接复用 Web 适配器
 *        measureDOM() 在 H5 端等价于 @skeleton/adapter-web
 *
 * 小程序端：
 *   - 使用 Taro.createSelectorQuery()（封装了 wx.createSelectorQuery）
 *   - 查询方式：selector 字符串（不是 DOM 引用）
 *   - 需要给目标节点设置 data-skeleton-id 属性
 *   - getComputedStyle 支持有限（小程序不支持所有 CSS 属性查询）
 *
 * 统一流程：
 * 1. 检测当前环境（Taro.getEnv()）
 * 2. H5 → 直接用 DOM API
 * 3. 小程序 → 用 createSelectorQuery
 *
 * 小程序测量限制（已知）：
 * - 无法获取 flexShrink / flexGrow（小程序 getComputedStyle 不支持）
 * - 固定宽度只能通过 width 数值判断
 * - computedStyle 字段需在 Taro 文档查阅支持列表
 */

import type { NodeMeasurement, NodeStyles, Rect, PlatformAdapter, Scheduler } from '@skeleton/core'
import { createWxNextTickScheduler, createRICScheduler } from '@skeleton/core'
import { TaroStorage } from './storage.js'

// ─── Taro 环境检测 ─────────────────────────────────────────────────────────────

type TaroEnv = 'WEB' | 'WEAPP' | 'SWAN' | 'ALIPAY' | 'TT' | 'QQ' | 'JD' | 'RN'

function getTaroEnv(): TaroEnv {
  try {
    const Taro = require('@tarojs/taro')
    return Taro.getEnv() as TaroEnv
  } catch {
    return 'WEB'
  }
}

// ─── 小程序 SelectorQuery 测量 ────────────────────────────────────────────────

interface MPRect {
  left: number
  top: number
  width: number
  height: number
  dataset?: Record<string, string>
}

interface MPComputedStyle {
  backgroundColor?: string
  borderRadius?: string
  borderWidth?: string
  opacity?: string
  overflow?: string
  minWidth?: string
  maxWidth?: string
  minHeight?: string
  maxHeight?: string
}

/**
 * 用 Taro.createSelectorQuery 测量指定选择器下的所有标记节点。
 *
 * 约定：
 * - 目标根节点设置 data-ske-root 属性
 * - 需要捕获的子节点设置 data-ske-node 属性（可选，不设则全量捕获）
 *
 * @param rootSelector  根节点 CSS 选择器，如 '.product-card'
 * @param context       小程序 this 对象（组件实例，选填）
 */
export async function measureBySelector(
  rootSelector: string,
  context?: unknown,
): Promise<NodeMeasurement | null> {
  return new Promise(resolve => {
    try {
      const Taro = require('@tarojs/taro')
      const query = context
        ? Taro.createSelectorQuery().in(context as any)
        : Taro.createSelectorQuery()

      // 先测量根节点
      query.select(rootSelector).boundingClientRect().exec((rootResults: MPRect[]) => {
        if (!rootResults?.[0]) { resolve(null); return }

        const rootRect = rootResults[0]
        const root: Rect = {
          left: rootRect.left,
          top: rootRect.top,
          width: rootRect.width,
          height: rootRect.height,
        }

        // 测量所有子节点（选择器 ${rootSelector} *）
        Taro.createSelectorQuery()
          .selectAll(`${rootSelector} [data-ske-node]`)
          .fields({
            rect: true,
            size: true,
            dataset: true,
            computedStyle: [
              'backgroundColor', 'borderRadius', 'borderWidth',
              'opacity', 'overflow', 'minWidth', 'maxWidth',
              'minHeight', 'maxHeight',
            ],
          })
          .exec((childResults: (MPRect & MPComputedStyle & { dataset?: Record<string, string> })[]) => {
            const children: NodeMeasurement[] = (childResults ?? []).map((item, i) => {
              const rect: Rect = {
                left: item.left ?? 0,
                top: item.top ?? 0,
                width: item.width ?? 0,
                height: item.height ?? 0,
              }
              return buildMPNode(item, rect, root, `mp-${i}`)
            })

            resolve({
              id: 'mp-root',
              tag: 'view',
              rect: root,
              styles: makeTransparentStyle(),
              children,
              isLeaf: false,
            })
          })
      })
    } catch (err) {
      console.warn('[skeleton-taro] measureBySelector failed:', err)
      resolve(null)
    }
  })
}

export function buildMPNode(
  item: MPRect & MPComputedStyle & { dataset?: Record<string, string> },
  rect: Rect,
  rootRect: Rect,
  id: string,
): NodeMeasurement {
  const tag = item.dataset?.['skeTag'] ?? 'view'
  const isLeaf = item.dataset?.['skeLeaf'] === '1' ||
    ['image', 'text', 'button', 'input', 'textarea', 'video', 'canvas'].includes(tag)

  const bg = item.backgroundColor ?? 'rgba(0, 0, 0, 0)'
  const br = item.borderRadius ?? '0'
  const bw = parseFloat(item.borderWidth ?? '0') || 0

  const minW = parseFloat(item.minWidth ?? '0') || 0
  const maxW = item.maxWidth === 'none' ? Infinity : (parseFloat(item.maxWidth ?? '0') || 0)

  const isFixedWidth = rect.width > 0 && rootRect.width > 0 && rect.width < rootRect.width * 0.4

  const styles: NodeStyles = {
    display: 'flex',
    visibility: 'visible',
    opacity: item.opacity ?? '1',
    overflow: item.overflow ?? 'hidden',
    backgroundColor: bg,
    backgroundImage: 'none',
    borderRadius: br,
    hasBorder: bw > 0,
    isFixedWidth,
    isFixedHeight: false,
    minWidth: minW,
    maxWidth: maxW,
    minHeight: 0,
    maxHeight: Infinity,
    boxShadow: 'none',
  }

  return {
    id,
    tag,
    rect,
    styles,
    children: [],  // 小程序不支持递归查询，children 通过 data-ske-node 平铺获取
    isLeaf,
  }
}

function makeTransparentStyle(): NodeStyles {
  return {
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
  }
}

// ─── 创建 Taro 适配器 ──────────────────────────────────────────────────────────

/**
 * Taro 平台适配器。
 *
 * H5：复用 Web DOM 测量（性能更好）
 * 小程序：createSelectorQuery 测量
 *
 * @param selector  小程序模式下的根节点选择器（H5 模式忽略）
 * @param context   小程序组件实例（Page.this），用于 in(context) 限定查询范围
 */
export function createTaroAdapter(selector?: string, context?: unknown): PlatformAdapter {
  const env = getTaroEnv()
  const isMP = env !== 'WEB'

  return {
    async measure(root: unknown): Promise<NodeMeasurement> {
      if (!isMP) {
        // H5 端：直接用 Web DOM 测量
        const { measureDOM } = await import('@skeleton/adapter-web')
        return measureDOM(root as Element)
      }

      // 小程序端
      const sel = selector ?? (typeof root === 'string' ? root : '.ske-capture-root')
      const result = await measureBySelector(sel, context)
      if (!result) throw new Error(`[skeleton-taro] measure failed for selector: ${sel}`)
      return result
    },

    createScheduler(): Scheduler {
      // H5 使用 rIC，小程序使用 wx.nextTick
      return isMP ? createWxNextTickScheduler() : createRICScheduler()
    },

    createStorage() {
      return new TaroStorage()
    },
  }
}
