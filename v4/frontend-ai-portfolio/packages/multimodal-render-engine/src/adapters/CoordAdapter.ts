/**
 * 坐标适配器 — 抽象接口
 *
 * 三种实现分别对应三种坐标系：图片（像素）、文档（页面+pt）、文本（字符偏移）
 *
 * @module adapters/CoordAdapter
 */

import type { Annotation, CoordAdapter, Point, Position, Rect } from '../core/types';

// Re-export 接口类型
export type { CoordAdapter } from '../core/types';

/**
 * 适配器基类 — 提供空间索引构建的公共逻辑
 */
export abstract class BaseCoordAdapter implements CoordAdapter {
  protected annotations: Annotation[] = [];
  protected destroyed = false;

  abstract toScreenRects(pos: Position): DOMRect[];
  abstract hitTest(pt: Point): string | null;
  abstract rangeSearch(rect: Rect): string[];
  abstract invalidate(): void;

  registerAnnotations(annotations: readonly Annotation[]): void {
    this.annotations = [...annotations];
    this.invalidate();
  }

  destroy(): void {
    this.destroyed = true;
    this.annotations = [];
  }
}