/**
 * 矩形画框工具
 *
 * 状态机流程：idle → drawing_ready → drawing → config_open → idle
 * 最小面积 400px²，Esc 取消，实时预览虚线框
 *
 * @module scenes/ocr-custom/DrawTool
 */

import type { Point } from '../../core/types';
import type { SVGLayerAPI } from '../../core/types';
import { normalizeRect } from '../../utils/coord';

const MIN_DRAW_AREA = 400;

type DrawState = 'idle' | 'ready' | 'drawing';

/**
 * 画框工具
 */
export class DrawTool {
  private state: DrawState = 'idle';
  private startPt: Point = { x: 0, y: 0 };
  private currentPt: Point = { x: 0, y: 0 };
  private container: HTMLElement;
  private svgLayer: SVGLayerAPI;
  private onDrawComplete: ((rect: { x: number; y: number; w: number; h: number }) => void) | null = null;
  private onCancel: (() => void) | null = null;

  // 绑定的事件处理器（用于解绑）
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor(
    container: HTMLElement,
    svgLayer: SVGLayerAPI,
  ) {
    this.container = container;
    this.svgLayer = svgLayer;

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundKeyDown = this.onKeyDown.bind(this);
  }

  /**
   * 激活画框模式
   */
  activate(
    onComplete: (rect: { x: number; y: number; w: number; h: number }) => void,
    onCancel: () => void,
  ): void {
    this.state = 'ready';
    this.onDrawComplete = onComplete;
    this.onCancel = onCancel;

    this.container.style.cursor = 'crosshair';
    this.container.addEventListener('pointerdown', this.boundPointerDown);
    this.container.addEventListener('pointermove', this.boundPointerMove);
    this.container.addEventListener('pointerup', this.boundPointerUp);
    document.addEventListener('keydown', this.boundKeyDown);
  }

  /**
   * 停用画框模式
   */
  deactivate(): void {
    this.state = 'idle';
    this.container.style.cursor = '';

    this.container.removeEventListener('pointerdown', this.boundPointerDown);
    this.container.removeEventListener('pointermove', this.boundPointerMove);
    this.container.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('keydown', this.boundKeyDown);

    this.svgLayer.hidePreviewRect();
    this.onDrawComplete = null;
    this.onCancel = null;
  }

  isActive(): boolean {
    return this.state !== 'idle';
  }

  // ---- 事件处理 ----

  private getRelativePoint(e: PointerEvent): Point {
    const bcr = this.container.getBoundingClientRect();
    return {
      x: e.clientX - bcr.x,
      y: e.clientY - bcr.y,
    };
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.state !== 'ready') return;

    this.state = 'drawing';
    this.startPt = this.getRelativePoint(e);
    this.currentPt = this.startPt;
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.state !== 'drawing') return;

    this.currentPt = this.getRelativePoint(e);
    const rect = normalizeRect(this.startPt, this.currentPt);
    this.svgLayer.showPreviewRect(rect);
  }

  private onPointerUp(_e: PointerEvent): void {
    if (this.state !== 'drawing') return;

    const rect = normalizeRect(this.startPt, this.currentPt);
    const area = rect.w * rect.h;

    this.svgLayer.hidePreviewRect();

    if (area < MIN_DRAW_AREA) {
      // 面积太小，视为误操作
      this.state = 'ready';
      return;
    }

    // 绘制完成
    this.state = 'idle';
    this.deactivate();
    this.onDrawComplete?.(rect);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.state === 'drawing') {
        this.svgLayer.hidePreviewRect();
        this.state = 'ready';
      } else if (this.state === 'ready') {
        this.deactivate();
        this.onCancel?.();
      }
      e.preventDefault();
    }
  }

  /** 销毁 */
  destroy(): void {
    this.deactivate();
  }
}