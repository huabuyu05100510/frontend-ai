/**
 * 文档坐标适配器
 *
 * 转换链：页码 + 页内坐标（pt）→ 屏幕坐标
 * pageScale = pageEl.offsetWidth / pageWidthPt
 * 每页独立缩放，叠加页面在滚动容器内的 offsetTop
 *
 * @module adapters/DocumentCoordAdapter
 */

import type { Point, Rect, Position, Annotation } from '../core/types';
import { BaseCoordAdapter } from './CoordAdapter';
import { SpatialIndex } from '../utils/rtree';

/** 点击容差 (px) */
const HIT_TOLERANCE = 2;

/**
 * 文档场景坐标适配器
 */
export class DocumentCoordAdapter extends BaseCoordAdapter {
  private pageBCRCache = new Map<number, DOMRect>();
  private pageScaleCache = new Map<number, number>();
  private spatialIndex = new SpatialIndex();
  private intersectionObserver: IntersectionObserver | null = null;

  constructor(
    private readonly pageRefs: Map<number, HTMLElement>,
    private readonly pageWidthPt: number,
    private readonly scrollContainer: HTMLElement,
  ) {
    super();
    this.capturePageMetrics();
    this.setupIntersectionObserver();
  }

  // ---- 坐标转换 ----

  toScreenRects(pos: Position): DOMRect[] {
    if (pos.kind !== 'page') return [];

    const pageEl = this.pageRefs.get(pos.page);
    if (!pageEl) {
      // 页面不在内存中（已回收）
      return [];
    }

    const scale = this.pageScaleCache.get(pos.page) ?? 1;
    const bcr = this.pageBCRCache.get(pos.page);
    if (!bcr) return [];

    const x = pos.bbox.x * scale + bcr.x;
    const y = pos.bbox.y * scale + bcr.y;
    const w = pos.bbox.w * scale;
    const h = pos.bbox.h * scale;

    return [new DOMRect(x, y, w, h)];
  }

  // ---- 命中检测 ----

  hitTest(pt: Point): string | null {
    // 将 viewport 坐标减去滚动偏移以匹配 R-Tree 中的坐标
    const scrollLeft = this.scrollContainer.scrollLeft;
    const scrollTop = this.scrollContainer.scrollTop;
    const adjustedPt: Point = {
      x: pt.x + scrollLeft,
      y: pt.y + scrollTop,
    };
    return this.spatialIndex.hitTest(adjustedPt, HIT_TOLERANCE);
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
    this.capturePageMetrics();
    this.rebuildIndex();
  }

  // ---- 资源释放 ----

  destroy(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.spatialIndex.clear();
    this.pageBCRCache.clear();
    this.pageScaleCache.clear();
    super.destroy();
  }

  // ---- 内部方法 ----

  private capturePageMetrics(): void {
    this.pageBCRCache.clear();
    this.pageScaleCache.clear();

    for (const [page, el] of this.pageRefs) {
      const bcr = el.getBoundingClientRect();
      this.pageBCRCache.set(page, bcr);
      this.pageScaleCache.set(
        page,
        bcr.width / this.pageWidthPt,
      );
    }
  }

  private rebuildIndex(): void {
    const items = this.annotations
      .filter(a => a.position.kind === 'page')
      .flatMap(a => {
        const rects = this.toScreenRects(a.position);
        return rects.map(rect => ({ id: a.id, rect }));
      })
      .filter(item => item.rect.width > 0 && item.rect.height > 0);

    this.spatialIndex.rebuild(items);
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        let needsInvalidate = false;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            needsInvalidate = true;
            break;
          }
        }
        if (needsInvalidate) {
          this.invalidate();
        }
      },
      { root: this.scrollContainer, rootMargin: '200px' },
    );

    for (const el of this.pageRefs.values()) {
      this.intersectionObserver.observe(el);
    }
  }
}