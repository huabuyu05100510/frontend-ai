import RBush from 'rbush'
import type { Point, Rect } from '../core/types'

interface IndexItem {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
}

/**
 * 基于 rbush 的空间索引封装，提供语义化 API
 */
export class SpatialIndex {
  private tree = new RBush<IndexItem>()

  /** 加载一批条目（增量） */
  load(items: Array<{ id: string; rect: DOMRect }>): void {
    const bulk = items.map(({ id, rect }) => ({
      minX: rect.left,
      minY: rect.top,
      maxX: rect.right,
      maxY: rect.bottom,
      id,
    }))
    this.tree.load(bulk)
  }

  /** 重建整个索引（先 clear 再 load） */
  rebuild(items: Array<{ id: string; rect: DOMRect }>): void {
    this.tree.clear()
    this.load(items)
  }

  /**
   * 点击命中测试，返回面积最小的命中 id（最精准匹配）
   * @param tolerance 点击容差（像素），默认 2
   */
  hitTest(pt: Point, tolerance = 2): string | null {
    const results = this.tree.search({
      minX: pt.x - tolerance,
      minY: pt.y - tolerance,
      maxX: pt.x + tolerance,
      maxY: pt.y + tolerance,
    })
    if (results.length === 0) return null
    // 返回面积最小的（最精准）
    results.sort(
      (a, b) =>
        (a.maxX - a.minX) * (a.maxY - a.minY) -
        (b.maxX - b.minX) * (b.maxY - b.minY)
    )
    return results[0].id
  }

  /** 矩形范围查询，返回所有命中的 id */
  rangeSearch(rect: Rect): string[] {
    const results = this.tree.search({
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.w,
      maxY: rect.y + rect.h,
    })
    return results.map(r => r.id)
  }

  /** 清空索引 */
  clear(): void {
    this.tree.clear()
  }
}
