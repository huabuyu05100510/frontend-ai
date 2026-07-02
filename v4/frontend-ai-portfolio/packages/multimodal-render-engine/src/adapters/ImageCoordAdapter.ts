/**
 * 图片坐标适配器
 *
 * 转换链：模型输出坐标（像素）→ CSS 坐标 → Viewport 坐标
 * scale = container.offsetWidth / image.naturalWidth
 * 使用 R-Tree 空间索引进行 hitTest
 *
 * @module adapters/ImageCoordAdapter
 */

import type { Point, Rect, Position, Annotation } from '../core/types';
import { BaseCoordAdapter } from './CoordAdapter';
import { SpatialIndex } from '../utils/rtree';

/** 点击容差 (px) */
const HIT_TOLERANCE = 2;

/**
 * 图片场景坐标适配器
 */
export class ImageCoordAdapter extends BaseCoordAdapter {
  private scale = 1;
  private containerBCR: DOMRect = new DOMRect();
  private spatialIndex = new SpatialIndex();
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly imgElement: HTMLImageElement,
    private readonly containerEl: HTMLElement,
  ) {
    super();
    this.calculateScale();
    this.captureContainerBCR();
    this.setupResizeObserver();
  }

  // ---- 坐标转换 ----

  toScreenRects(pos: Position): DOMRect[] {
    if (pos.kind !== 'pixel') return [];

    const x = pos.bbox.x * this.scale + this.containerBCR.x;
    const y = pos.bbox.y * this.scale + this.containerBCR.y;
    const w = pos.bbox.w * this.scale;
    const h = pos.bbox.h * this.scale;

    return [new DOMRect(x, y, w, h)];
  }

  // ---- 命中检测 ----

  hitTest(pt: Point): string | null {
    return this.spatialIndex.hitTest(pt, HIT_TOLERANCE);
  }

  rangeSearch(rect: Rect): string[] {
    return this.spatialIndex.rangeSearch(rect);
  }

  // ---- 索引管理 ----

  registerAnnotations(annotations: readonly Annotation[]): void {
    super.registerAnnotations(annotations);
    this.rebuildIndex();
  }

  invalidate(): void {
    this.calculateScale();
    this.captureContainerBCR();
    this.rebuildIndex();
  }

  // ---- 资源释放 ----

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.spatialIndex.clear();
    super.destroy();
  }

  /** 获取当前缩放比（调试用） */
  getScale(): number {
    return this.scale;
  }

  // ---- 内部方法 ----

  private calculateScale(): void {
    if (!this.imgElement.naturalWidth || !this.containerEl.offsetWidth) {
      this.scale = 1;
      return;
    }
    this.scale = this.containerEl.offsetWidth / this.imgElement.naturalWidth;
  }

  private captureContainerBCR(): void {
    this.containerBCR = this.containerEl.getBoundingClientRect();
  }

  private rebuildIndex(): void {
    const items = this.annotations
      .filter(a => a.position.kind === 'pixel')
      .map(a => {
        const rects = this.toScreenRects(a.position);
        return { id: a.id, rect: rects[0] };
      })
      .filter(item => item.rect);

    this.spatialIndex.rebuild(items);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.invalidate();
    });
    this.resizeObserver.observe(this.containerEl);
  }
}