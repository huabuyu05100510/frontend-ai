import type { ParagraphMapper } from './ParagraphMapper'

/**
 * 双栏滚动同步控制器
 * 通过 ParagraphMapper 实现段落级对齐滚动
 */
export class ScrollSyncBridge {
  private locked = false
  private leftHandler: ((e: Event) => void) | null = null
  private rightHandler: ((e: Event) => void) | null = null

  constructor(
    private leftEl: HTMLElement,
    private rightEl: HTMLElement,
    private mapper: ParagraphMapper
  ) {}

  /** 绑定滚动事件 */
  attach(): void {
    this.leftHandler = () => this.onScroll('left')
    this.rightHandler = () => this.onScroll('right')
    this.leftEl.addEventListener('scroll', this.leftHandler, { passive: true })
    this.rightEl.addEventListener('scroll', this.rightHandler, { passive: true })
  }

  /** 解绑滚动事件 */
  detach(): void {
    if (this.leftHandler) this.leftEl.removeEventListener('scroll', this.leftHandler)
    if (this.rightHandler) this.rightEl.removeEventListener('scroll', this.rightHandler)
    this.leftHandler = null
    this.rightHandler = null
  }

  private onScroll(side: 'left' | 'right'): void {
    if (this.locked) return
    this.locked = true

    const scrollTop = side === 'left' ? this.leftEl.scrollTop : this.rightEl.scrollTop
    const mapped = this.mapper.lookupByScrollTop(side, scrollTop)

    if (mapped) {
      const targetEl = side === 'left' ? this.rightEl : this.leftEl
      const targetY = side === 'left' ? mapped.rightY : mapped.leftY
      // Adjust for relative offset within the entry
      const sourceEl = side === 'left' ? this.leftEl : this.rightEl
      const sourceY = side === 'left' ? mapped.leftY : mapped.rightY
      const delta = scrollTop - sourceY
      targetEl.scrollTop = targetY + delta
    }

    requestAnimationFrame(() => {
      this.locked = false
    })
  }
}
