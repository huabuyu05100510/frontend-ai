/**
 * 交互状态机 — 管理 8 种交互状态及转换
 *
 * 状态列表：idle, hover, selected, multiSelected, drawing, resizing, moving, configuring
 * 非法转换：console.warn 但不抛异常
 * 状态变化时通过 EventBus 广播
 *
 * @module core/StateMachine
 */

import type { Point, Rect, InteractionState, KernelEvent } from './types';
import type { EventBus } from './EventBus';

/** 状态变更回调 */
type StateChangeHandler = (newState: InteractionState, prevState: InteractionState) => void;

/** 最小绘制面积（px²） */
const MIN_DRAW_AREA = 400;

/**
 * 交互状态机
 *
 * @example
 * ```ts
 * const sm = new AnnotationStateMachine(eventBus);
 * sm.onChange((newState, prevState) => {
 *   console.log(`state: ${prevState.type} -> ${newState.type}`);
 * });
 * sm.hover('a1');    // idle -> hover
 * sm.select('a1');   // hover -> selected
 * sm.reset();        // selected -> idle
 * ```
 */
export class AnnotationStateMachine {
  private state: InteractionState = { type: 'idle' };
  private readonly changeHandlers = new Set<StateChangeHandler>();

  constructor(private readonly eventBus: EventBus) {}

  /** 获取当前状态（只读） */
  getState(): InteractionState {
    return this.state;
  }

  /** 订阅状态变化 */
  onChange(handler: StateChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  // ---- 基础操作 ----

  hover(id: string | null): void {
    if (id === null) {
      this.transition({ type: 'idle' });
      return;
    }
    // 允许从 idle, selected, multiSelected 进入 hover
    if (this.state.type === 'idle' || this.state.type === 'selected' ||
        this.state.type === 'multiSelected' || this.state.type === 'hover') {
      this.transition({ type: 'hover', annotationId: id });
    } else {
      this.warnIllegal('hover', this.state.type);
    }
  }

  select(id: string): void {
    if (this.state.type === 'idle' || this.state.type === 'hover' ||
        this.state.type === 'selected' || this.state.type === 'resizing' ||
        this.state.type === 'moving' || this.state.type === 'configuring') {
      this.transition({ type: 'selected', annotationId: id });
    } else {
      this.warnIllegal('select', this.state.type);
    }
  }

  multiSelect(ids: string[]): void {
    if (this.state.type === 'selected' || this.state.type === 'multiSelected' ||
        this.state.type === 'hover' || this.state.type === 'idle') {
      this.transition({ type: 'multiSelected', annotationIds: ids });
    } else {
      this.warnIllegal('multiSelect', this.state.type);
    }
  }

  // ---- 绘制 ----

  startDraw(pt: Point): void {
    if (this.state.type === 'idle' || this.state.type === 'selected') {
      this.transition({ type: 'drawing', startPt: pt, currentPt: pt });
    } else {
      this.warnIllegal('startDraw', this.state.type);
    }
  }

  updateDraw(pt: Point): void {
    if (this.state.type === 'drawing') {
      this.transition({ type: 'drawing', startPt: this.state.startPt, currentPt: pt });
    } else {
      this.warnIllegal('updateDraw', this.state.type);
    }
  }

  endDraw(): Rect | null {
    if (this.state.type !== 'drawing') {
      this.warnIllegal('endDraw', this.state.type);
      return null;
    }

    const rect = normalizeRect(this.state.startPt, this.state.currentPt);
    const area = rect.w * rect.h;

    if (area < MIN_DRAW_AREA) {
      this.transition({ type: 'idle' });
      return null;
    }

    return rect;
  }

  // ---- 缩放 ----

  startResize(fieldId: string, handleIndex: number, originalRect: Rect): void {
    if (this.state.type === 'selected' || this.state.type === 'hover' ||
        this.state.type === 'configuring') {
      this.transition({ type: 'resizing', fieldId, handleIndex, originalRect });
    } else {
      this.warnIllegal('startResize', this.state.type);
    }
  }

  endResize(): Rect | null {
    if (this.state.type !== 'resizing') {
      this.warnIllegal('endResize', this.state.type);
      return null;
    }
    this.transition({ type: 'selected', annotationId: this.state.fieldId });
    return null; // 实际 rect 由调用方通过 AnnotationStore 获取
  }

  // ---- 移动 ----

  startMove(fieldId: string, offset: Point, originalRect: Rect): void {
    if (this.state.type === 'selected' || this.state.type === 'hover' ||
        this.state.type === 'configuring') {
      this.transition({ type: 'moving', fieldId, offset, originalRect });
    } else {
      this.warnIllegal('startMove', this.state.type);
    }
  }

  endMove(): Rect | null {
    if (this.state.type !== 'moving') {
      this.warnIllegal('endMove', this.state.type);
      return null;
    }
    this.transition({ type: 'selected', annotationId: this.state.fieldId });
    return null;
  }

  // ---- 配置 ----

  startConfiguring(fieldId: string): void {
    if (this.state.type === 'drawing' || this.state.type === 'selected' ||
        this.state.type === 'hover') {
      this.transition({ type: 'configuring', fieldId });
    } else {
      this.warnIllegal('startConfiguring', this.state.type);
    }
  }

  endConfiguring(): void {
    if (this.state.type === 'configuring') {
      this.transition({ type: 'idle' });
    } else {
      this.warnIllegal('endConfiguring', this.state.type);
    }
  }

  // ---- 重置 ----

  reset(): void {
    this.transition({ type: 'idle' });
  }

  // ---- 内部方法 ----

  private transition(newState: InteractionState): void {
    const prevState = this.state;
    this.state = newState;

    // 通知所有订阅者
    for (const handler of this.changeHandlers) {
      try {
        handler(newState, prevState);
      } catch (error) {
        console.error('[StateMachine] change handler error:', error);
      }
    }
  }

  private warnIllegal(action: string, fromState: string): void {
    console.warn(`[StateMachine] illegal transition: ${fromState} → ${action}`);
  }
}

/** 确保 x/y 为左上角，w/h 为正数 */
function normalizeRect(p1: Point, p2: Point): Rect {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  return { x, y, w, h };
}