/**
 * R-Tree 空间索引封装
 *
 * 用于标注 hitTest 和 rangeSearch。
 * 多框重叠时返回面积最小的（最精准匹配）。
 *
 * @module utils/rtree
 */

import type { Point, Rect } from '../core/types';

/** R-Tree 索引项 */
interface IndexItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

/** 简单的 R-Tree 实现（不依赖外部 rbush 库时的自实现） */
export class SpatialIndex {
  private items: IndexItem[] = [];

  /**
   * 批量加载（替换全部索引）
   */
  load(items: Array<{ id: string; rect: DOMRect }>): void {
    this.items = items.map(item => ({
      minX: item.rect.x,
      minY: item.rect.y,
      maxX: item.rect.x + item.rect.width,
      maxY: item.rect.y + item.rect.height,
      id: item.id,
    }));
  }

  /**
   * 重建索引（等价于 load）
   */
  rebuild(items: Array<{ id: string; rect: DOMRect }>): void {
    this.load(items);
  }

  /**
   * 命中检测
   *
   * 返回面积最小的命中标注。
   *
   * @param pt 检测点（屏幕坐标）
   * @param tolerance 容差（px），命中区域向外扩展
   */
  hitTest(pt: Point, tolerance = 2): string | null {
    let bestId: string | null = null;
    let bestArea = Infinity;

    for (const item of this.items) {
      if (
        pt.x >= item.minX - tolerance &&
        pt.x <= item.maxX + tolerance &&
        pt.y >= item.minY - tolerance &&
        pt.y <= item.maxY + tolerance
      ) {
        const area = (item.maxX - item.minX) * (item.maxY - item.minY);
        if (area < bestArea) {
          bestArea = area;
          bestId = item.id;
        }
      }
    }

    return bestId;
  }

  /**
   * 矩形范围查询
   *
   * @param rect 查询矩形（屏幕坐标）
   * @returns 命中的 id 列表
   */
  rangeSearch(rect: Rect): string[] {
    const ids: string[] = [];

    for (const item of this.items) {
      // AABB 相交检测
      if (
        rect.x + rect.w >= item.minX &&
        item.maxX >= rect.x &&
        rect.y + rect.h >= item.minY &&
        item.maxY >= rect.y
      ) {
        ids.push(item.id);
      }
    }

    return ids;
  }

  /** 清空索引 */
  clear(): void {
    this.items = [];
  }

  /** 索引项数量 */
  get size(): number {
    return this.items.length;
  }
}