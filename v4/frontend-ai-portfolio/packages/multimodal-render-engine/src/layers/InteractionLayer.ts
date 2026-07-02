/**
 * 透明事件接管层
 *
 * 在 Canvas + SVG 之上覆盖透明 div，统一接管鼠标事件，
 * 通过 rAF 节流转发到适配器的 hitTest。
 *
 * @module layers/InteractionLayer
 */

import type { Point } from '../core/types';

type HitTester = (pt: Point) => string | null;
type HoverCallback = (id: string | null) => void;

/**
 * 交互事件管理器
 *
 * 接管 mousemove / click 事件，通过 rAF 节流。
 */
export class InteractionLayer {
  private pendingPt: Point | null = null;
  private rafId: number | null = null;
  private hitTester: HitTester;
  private hoverCallback: HoverCallback | null = null;
  private clickCallback: ((id: string | null) => void) | null = null;
  private attached = false;

  constructor(
    private readonly container: HTMLElement,
    hitTester: HitTester,
  ) {
    this.hitTester = hitTester;
  }

  /** 设置 hover 回调 */
  onHover(cb: HoverCallback): void {
    this.hoverCallback = cb;
  }

  /** 设置 click 回调 */
  setOnClick(cb: (id: string | null) => void): void {
    this.clickCallback = cb;
  }

  /** 更新 hitTester（用于适配器切换） */
  setHitTester(hitTester: HitTester): void {
    this.hitTester = hitTester;
  }

  /** 绑定事件 */
  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.container.addEventListener('mousemove', this.onMouseMove);
    this.container.addEventListener('mouseleave', this.onMouseLeave);
    this.container.addEventListener('click', this.handleClick);
    this.startLoop();
  }

  /** 解绑事件 */
  detach(): void {
    this.attached = false;

    this.container.removeEventListener('mousemove', this.onMouseMove);
    this.container.removeEventListener('mouseleave', this.onMouseLeave);
    this.container.removeEventListener('click', this.handleClick);
    this.stopLoop();
  }

  /** 销毁 */
  destroy(): void {
    this.detach();
    this.hoverCallback = null;
    this.clickCallback = null;
  }

  // ---- 事件处理 ----

  private onMouseMove = (e: MouseEvent): void => {
    this.pendingPt = { x: e.clientX, y: e.clientY };
  };

  private onMouseLeave = (): void => {
    this.pendingPt = null;
    this.hoverCallback?.(null);
  };

  private handleClick = (e: MouseEvent): void => {
    const pt = { x: e.clientX, y: e.clientY };
    const id = this.hitTester(pt);
    this.clickCallback?.(id);
  };

  // ---- rAF 循环 ----

  private startLoop(): void {
    const loop = (): void => {
      if (!this.attached) return;
      this.rafId = requestAnimationFrame(loop);

      if (this.pendingPt) {
        const id = this.hitTester(this.pendingPt);
        this.hoverCallback?.(id);
        this.pendingPt = null;
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}