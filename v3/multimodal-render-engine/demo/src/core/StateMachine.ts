import type { InteractionState, Point, Rect } from './types'
import type { EventBus } from './EventBus'

type StateChangeHandler = (state: InteractionState) => void

/**
 * 交互状态机
 * 管理 idle / hover / selected / multiSelected / drawing 五种状态转换
 */
export class StateMachine {
  private state: InteractionState = { type: 'idle' }
  private listeners = new Set<StateChangeHandler>()

  constructor(private bus: EventBus) {}

  /** 获取当前状态 */
  getState(): InteractionState {
    return this.state
  }

  /** hover 进入/离开 */
  hover(id: string | null): void {
    const current = this.state
    if (current.type === 'drawing') return

    if (id === null) {
      if (current.type === 'hover') {
        this.transition({ type: 'idle' })
      }
    } else {
      if (current.type !== 'hover' || current.annotationId !== id) {
        this.transition({ type: 'hover', annotationId: id })
        this.bus.emit({ type: 'ANNOTATION_HOVER', id })
      }
    }
  }

  /** 选中单个标注 */
  select(id: string): void {
    this.transition({ type: 'selected', annotationId: id })
    this.bus.emit({ type: 'ANNOTATION_SELECT', id })
  }

  /** 多选 */
  multiSelect(ids: string[]): void {
    this.transition({ type: 'multiSelected', annotationIds: ids })
    this.bus.emit({ type: 'ANNOTATION_MULTI_SELECT', ids })
  }

  /** 开始画框 */
  startDraw(pt: Point): void {
    this.transition({ type: 'drawing', startPt: pt, currentPt: pt })
    this.bus.emit({ type: 'DRAW_START', pt })
  }

  /** 更新画框 */
  updateDraw(pt: Point): void {
    if (this.state.type !== 'drawing') return
    this.transition({ ...this.state, currentPt: pt })
    this.bus.emit({ type: 'DRAW_UPDATE', pt })
  }

  /**
   * 结束画框，面积 < 400px² 返回 null（无效操作）
   */
  endDraw(): Rect | null {
    if (this.state.type !== 'drawing') return null
    const { startPt, currentPt } = this.state
    const rect: Rect = {
      x: Math.min(startPt.x, currentPt.x),
      y: Math.min(startPt.y, currentPt.y),
      w: Math.abs(currentPt.x - startPt.x),
      h: Math.abs(currentPt.y - startPt.y),
    }
    this.transition({ type: 'idle' })
    if (rect.w * rect.h < 400) return null
    this.bus.emit({ type: 'DRAW_END', rect })
    return rect
  }

  /** 重置到 idle */
  reset(): void {
    this.transition({ type: 'idle' })
    this.bus.emit({ type: 'ANNOTATION_HOVER', id: null })
  }

  /** 订阅状态变化，返回取消订阅函数 */
  onChange(handler: StateChangeHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  private transition(next: InteractionState): void {
    this.state = next
    this.listeners.forEach(h => h(next))
  }
}
