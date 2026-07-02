import type { Paragraph, ParagraphMapping } from '../../core/types'

interface AlignEntry {
  sourceId: string
  targetId: string
  leftY: number
  rightY: number
}

/**
 * 段落对齐映射构建器
 * 用于翻译双栏的滚动同步
 */
export class ParagraphMapper {
  private entries: AlignEntry[] = []
  private leftEntries: AlignEntry[] = []
  private rightEntries: AlignEntry[] = []

  /**
   * 根据段落列表和映射关系构建对齐表
   * @param src 原文段落（左栏）
   * @param tgt 译文段落（右栏）
   * @param mappings 映射关系
   * @param leftContainer 左栏滚动容器（用于计算 offsetTop）
   * @param rightContainer 右栏滚动容器
   */
  buildAlignMap(
    src: Paragraph[],
    tgt: Paragraph[],
    mappings: ParagraphMapping[],
    leftContainer: HTMLElement,
    rightContainer: HTMLElement
  ): Map<string, { leftY: number; rightY: number }> {
    const result = new Map<string, { leftY: number; rightY: number }>()

    const leftEls = new Map<string, HTMLElement>()
    const rightEls = new Map<string, HTMLElement>()

    // Build element maps from containers
    leftContainer.querySelectorAll('[data-para-id]').forEach(el => {
      const id = (el as HTMLElement).dataset.paraId!
      leftEls.set(id, el as HTMLElement)
    })
    rightContainer.querySelectorAll('[data-para-id]').forEach(el => {
      const id = (el as HTMLElement).dataset.paraId!
      rightEls.set(id, el as HTMLElement)
    })

    this.entries = []

    for (const mapping of mappings) {
      const leftEl = leftEls.get(mapping.sourceId)
      const rightEl = rightEls.get(mapping.targetId)
      if (!leftEl || !rightEl) continue

      const leftY = leftEl.offsetTop
      const rightY = rightEl.offsetTop

      const entry: AlignEntry = {
        sourceId: mapping.sourceId,
        targetId: mapping.targetId,
        leftY,
        rightY,
      }

      this.entries.push(entry)
      result.set(mapping.sourceId, { leftY, rightY })
    }

    this.leftEntries = [...this.entries].sort((a, b) => a.leftY - b.leftY)
    this.rightEntries = [...this.entries].sort((a, b) => a.rightY - b.rightY)

    return result
  }

  /**
   * 根据滚动位置查找最近的对齐段落
   * 使用二分查找
   */
  lookupByScrollTop(
    side: 'left' | 'right',
    scrollTop: number
  ): { leftY: number; rightY: number } | null {
    const arr = side === 'left' ? this.leftEntries : this.rightEntries
    if (arr.length === 0) return null

    const key = side === 'left' ? 'leftY' : 'rightY'

    // Binary search for closest entry
    let lo = 0
    let hi = arr.length - 1

    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid][key] <= scrollTop) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }

    // lo is now the first entry > scrollTop, pick lo-1
    const idx = Math.max(0, lo - 1)
    const entry = arr[idx]
    return { leftY: entry.leftY, rightY: entry.rightY }
  }
}
