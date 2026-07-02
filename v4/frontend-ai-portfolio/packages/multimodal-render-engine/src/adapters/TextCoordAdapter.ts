/**
 * 文本坐标适配器
 *
 * 转换链：字符偏移量 → DOM Range → getClientRects() → 屏幕 DOMRect
 * 字体/布局变化时自动 invalidate
 *
 * @module adapters/TextCoordAdapter
 */

import type { Point, Rect, Position, Annotation } from '../core/types';
import { BaseCoordAdapter } from './CoordAdapter';
import { SpatialIndex } from '../utils/rtree';

/** 点击容差 (px) */
const HIT_TOLERANCE = 2;

/** 相邻 rect 合并阈值 (px) */
const MERGE_GAP = 2;

/**
 * 文本场景坐标适配器
 */
export class TextCoordAdapter extends BaseCoordAdapter {
  private offsetMap = new Map<number, { node: Text; offset: number }>();
  private annotationOffsets = new Map<string, { from: number; to: number }>();
  private spatialIndex = new SpatialIndex();
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private fontReadyHandler: (() => void) | null = null;
  private invalidatePending = false;

  constructor(
    private readonly editorEl: HTMLElement,
    private readonly getNodeAt: (offset: number) => { node: Text; offset: number },
  ) {
    super();
    this.setupObservers();
  }

  // ---- 坐标转换 ----

  toScreenRects(pos: Position): DOMRect[] {
    if (pos.kind !== 'offset') return [];

    const startNode = this.getNodeAt(pos.from);
    const endNode = this.getNodeAt(pos.to);

    try {
      const range = document.createRange();
      range.setStart(startNode.node, startNode.offset);
      range.setEnd(endNode.node, endNode.offset);

      const rects = Array.from(range.getClientRects());
      range.detach();

      return this.mergeAdjacentRects(rects);
    } catch (error) {
      console.warn('[TextCoordAdapter] range creation failed:', error);
      return [];
    }
  }

  // ---- 命中检测 ----

  hitTest(pt: Point): string | null {
    // 使用 caretPositionFromPoint 获取点击位置的文本偏移
    if (document.caretPositionFromPoint) {
      const caretPos = document.caretPositionFromPoint(pt.x, pt.y);
      if (caretPos && caretPos.offsetNode) {
        return this.findAnnotationAtOffset(caretPos.offset);
      }
    }
    // fallback: R-Tree 空间查询
    return this.spatialIndex.hitTest(pt, HIT_TOLERANCE);
  }

  rangeSearch(rect: Rect): string[] {
    return this.spatialIndex.rangeSearch(rect);
  }

  // ---- 索引管理 ----

  registerAnnotations(annotations: readonly Annotation[]): void {
    super.registerAnnotations(annotations);
    this.annotationOffsets.clear();
    for (const ann of annotations) {
      if (ann.position.kind === 'offset') {
        this.annotationOffsets.set(ann.id, {
          from: ann.position.from,
          to: ann.position.to,
        });
      }
    }
    this.rebuildIndex();
  }

  invalidate(): void {
    this.rebuildIndex();
  }

  // ---- 资源释放 ----

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    if (this.fontReadyHandler && document.fonts) {
      document.fonts.removeEventListener('loadingdone', this.fontReadyHandler);
    }
    this.fontReadyHandler = null;
    this.spatialIndex.clear();
    this.offsetMap.clear();
    this.annotationOffsets.clear();
    super.destroy();
  }

  // ---- 内部方法 ----

  private findAnnotationAtOffset(offset: number): string | null {
    for (const [id, range] of this.annotationOffsets) {
      if (offset >= range.from && offset < range.to) {
        return id;
      }
    }
    return null;
  }

  private mergeAdjacentRects(rects: readonly DOMRect[]): DOMRect[] {
    if (rects.length <= 1) return [...rects];

    const merged: DOMRect[] = [];
    let current = DOMRect.fromRect(rects[0]);

    for (let i = 1; i < rects.length; i++) {
      const next = rects[i];
      // 同一行：y 接近且 x 接近
      if (Math.abs(current.y - next.y) < MERGE_GAP &&
          Math.abs(current.bottom - next.bottom) < MERGE_GAP &&
          (next.x - current.right) < MERGE_GAP) {
        // 合并
        const newRight = Math.max(current.right, next.right);
        const newBottom = Math.max(current.bottom, next.bottom);
        current = new DOMRect(
          current.x,
          Math.min(current.y, next.y),
          newRight - current.x,
          newBottom - Math.min(current.y, next.y),
        );
      } else {
        merged.push(current);
        current = DOMRect.fromRect(next);
      }
    }
    merged.push(current);
    return merged;
  }

  private rebuildIndex(): void {
    const items: Array<{ id: string; rect: DOMRect }> = [];

    for (const [id, range] of this.annotationOffsets) {
      const pos: Position = { kind: 'offset', from: range.from, to: range.to };
      const rects = this.toScreenRects(pos);
      for (const rect of rects) {
        if (rect.width > 0 && rect.height > 0) {
          items.push({ id, rect });
        }
      }
    }

    this.spatialIndex.rebuild(items);
  }

  private setupObservers(): void {
    // ResizeObserver
    this.resizeObserver = new ResizeObserver(() => this.scheduleInvalidate());
    this.resizeObserver.observe(this.editorEl);

    // MutationObserver
    this.mutationObserver = new MutationObserver(() => {
      this.scheduleInvalidate();
    });
    this.mutationObserver.observe(this.editorEl, {
      attributes: true,
      subtree: true,
      attributeFilter: ['style', 'class'],
    });

    // 字体加载
    if (document.fonts) {
      this.fontReadyHandler = () => this.scheduleInvalidate();
      document.fonts.addEventListener('loadingdone', this.fontReadyHandler);
    }
  }

  private scheduleInvalidate(): void {
    if (this.invalidatePending) return;
    this.invalidatePending = true;

    // 双 rAF 等 layout 稳定
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.invalidatePending = false;
        if (!this.destroyed) {
          this.invalidate();
        }
      });
    });
  }
}