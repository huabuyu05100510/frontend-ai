/**
 * 段落对齐映射构建器
 *
 * 基于翻译 API 返回的 ParagraphMapping 构建原文-译文 Y 轴对齐索引。
 * 支持二分查找最近段落。
 *
 * @module scenes/translation/ParagraphMapper
 */

import type { Paragraph, ParagraphMapping } from '../../core/types';

interface AlignEntry {
  leftY: number;
  rightY: number;
}

/**
 * 段落映射器
 */
export class ParagraphMapper {
  private alignMap = new Map<string, AlignEntry>();
  /** 排序后的左侧 Y 列表（用于二分查找） */
  private leftYList: Array<{ id: string; y: number }> = [];
  /** 排序后的右侧 Y 列表 */
  private rightYList: Array<{ id: string; y: number }> = [];

  /**
   * 构建对齐映射
   *
   * @param srcParagraphs 原文段落列表
   * @param tgtParagraphs 译文段落列表
   * @param mappings 对齐关系
   */
  buildAlignMap(
    srcParagraphs: Paragraph[],
    tgtParagraphs: Paragraph[],
    mappings: ParagraphMapping[],
  ): Map<string, AlignEntry> {
    this.alignMap.clear();
    this.leftYList = [];
    this.rightYList = [];

    // 构建 target ID → Paragraph 快速查找
    const tgtMap = new Map<string, Paragraph>();
    for (const p of tgtParagraphs) {
      tgtMap.set(p.id, p);
    }
    const srcMap = new Map<string, Paragraph>();
    for (const p of srcParagraphs) {
      srcMap.set(p.id, p);
    }

    for (const mapping of mappings) {
      const srcPara = srcMap.get(mapping.sourceId);
      const tgtPara = tgtMap.get(mapping.targetId);
      if (!srcPara || !tgtPara) continue;

      const entry: AlignEntry = {
        leftY: srcPara.bbox.y,
        rightY: tgtPara.bbox.y,
      };

      this.alignMap.set(mapping.sourceId, entry);
      this.leftYList.push({ id: mapping.sourceId, y: srcPara.bbox.y });
      this.rightYList.push({ id: mapping.targetId, y: tgtPara.bbox.y });
    }

    // 按 Y 排序
    this.leftYList.sort((a, b) => a.y - b.y);
    this.rightYList.sort((a, b) => a.y - b.y);

    return this.alignMap;
  }

  /**
   * 根据段落 ID 查找对齐信息
   */
  lookup(id: string): AlignEntry | undefined {
    return this.alignMap.get(id);
  }

  /**
   * 根据滚动位置查找最近段落
   *
   * @param side 左侧或右侧
   * @param scrollTop 当前滚动位置
   */
  lookupByScrollTop(
    side: 'left' | 'right',
    scrollTop: number,
  ): AlignEntry | undefined {
    const list = side === 'left' ? this.leftYList : this.rightYList;
    if (list.length === 0) return undefined;

    // 二分查找：找到 y ≤ scrollTop 的最大项
    let lo = 0;
    let hi = list.length - 1;

    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (list[mid].y <= scrollTop) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const nearest = list[lo];
    return this.alignMap.get(nearest.id);
  }

  /** 映射条目数 */
  get size(): number {
    return this.alignMap.size;
  }
}