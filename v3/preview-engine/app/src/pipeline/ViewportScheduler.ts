import type { SchedulePlan } from '../kernel/types'
import { CumulativeIndex } from './CumulativeIndex'

// ============================================================================
// ViewportScheduler — 视口驱动调度
//   输入滚动位置，输出「该渲染谁 / 该预取谁 / 该回收谁」。
//   配合对象池实现恒定内存：离开预取窗口的单元立即回收。
// ============================================================================

export interface SchedulerOptions {
  /** 可见区前后各预取的单元数（overscan） */
  overscan?: number
}

function listRange(start: number, end: number): number[] {
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

export class ViewportScheduler {
  private index: CumulativeIndex
  private overscan: number
  private active = new Set<number>() // 当前保留（已渲染/预取）的单元
  private lastVisibleKey = ''
  private lastWindowKey = ''

  constructor(index: CumulativeIndex, opts: SchedulerOptions = {}) {
    this.index = index
    this.overscan = opts.overscan ?? 3
  }

  update(scrollTop: number, viewportHeight: number): SchedulePlan {
    const n = this.index.count
    if (n === 0) return { visible: [], prefetch: [], recycle: [] }

    const vr = this.index.rangeForViewport(scrollTop, viewportHeight)
    const visibleList = vr.end >= vr.start ? listRange(vr.start, vr.end) : []
    const visibleSet = new Set(visibleList)

    const ws = Math.max(0, vr.start - this.overscan)
    const we = Math.min(n - 1, vr.end + this.overscan)
    const windowList = listRange(ws, we)
    const newActive = new Set(windowList)

    const recycle: number[] = []
    for (const x of this.active) if (!newActive.has(x)) recycle.push(x)

    const visibleKey = visibleList.join(',')
    const windowKey = windowList.join(',')
    const visibleChanged = visibleKey !== this.lastVisibleKey
    const windowChanged = windowKey !== this.lastWindowKey

    const prefetchList = windowList.filter((x) => !visibleSet.has(x))

    this.active = newActive
    this.lastVisibleKey = visibleKey
    this.lastWindowKey = windowKey

    return {
      visible: visibleChanged ? visibleList : [],
      prefetch: windowChanged ? prefetchList : [],
      recycle,
    }
  }

  /** 当前保留（已就绪/预取）的单元集合 */
  rendered(): number[] {
    return [...this.active]
  }
}
