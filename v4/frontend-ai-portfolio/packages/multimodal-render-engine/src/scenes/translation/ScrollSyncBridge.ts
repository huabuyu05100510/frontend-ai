/**
 * 滚动同步控制器
 *
 * 基于段落对齐映射，同步左右双栏滚动位置。
 * 使用 lock 标志防止循环触发，500ms 超时强制解锁。
 *
 * @module scenes/translation/ScrollSyncBridge
 */

import type { ParagraphMapper } from './ParagraphMapper';

const LOCK_TIMEOUT = 500;

/**
 * 滚动同步桥接器
 */
export class ScrollSyncBridge {
  private locked = false;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollHandlers: Array<() => void> = [];
  private attached = false;

  constructor(
    private readonly leftEl: HTMLElement,
    private readonly rightEl: HTMLElement,
    private readonly mapper: ParagraphMapper,
  ) {}

  /**
   * 绑定 scroll 事件
   */
  attach(): void {
    if (this.attached) return;
    this.attached = true;

    const leftHandler = () => this.onScroll('left', this.leftEl.scrollTop);
    const rightHandler = () => this.onScroll('right', this.rightEl.scrollTop);

    this.leftEl.addEventListener('scroll', leftHandler, { passive: true });
    this.rightEl.addEventListener('scroll', rightHandler, { passive: true });

    this.scrollHandlers = [leftHandler, rightHandler];
  }

  /**
   * 解绑 scroll 事件
   */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    this.leftEl.removeEventListener('scroll', this.scrollHandlers[0]);
    this.rightEl.removeEventListener('scroll', this.scrollHandlers[1]);
    this.scrollHandlers = [];
    this.clearLock();
  }

  /**
   * 手动触发同步（外部调用）
   */
  syncToParagraph(paragraphId: string): void {
    const mapping = this.mapper.lookup(paragraphId);
    if (mapping) {
      this.rightEl.scrollTo({ top: mapping.rightY, behavior: 'instant' });
    }
  }

  /** 销毁 */
  destroy(): void {
    this.detach();
  }

  // ---- 内部 ----

  private onScroll(side: 'left' | 'right', scrollTop: number): void {
    if (this.locked) return;

    this.lock();

    const mapping = this.mapper.lookupByScrollTop(side, scrollTop);
    if (mapping) {
      const targetY = side === 'left' ? mapping.rightY : mapping.leftY;
      const targetEl = side === 'left' ? this.rightEl : this.leftEl;

      targetEl.scrollTo({ top: targetY, behavior: 'instant' });
    }
  }

  private lock(): void {
    this.locked = true;
    this.lockTimer = setTimeout(() => {
      this.clearLock();
      console.warn('[ScrollSyncBridge] lock timeout, force-unlocking');
    }, LOCK_TIMEOUT);
  }

  private clearLock(): void {
    this.locked = false;
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
  }
}