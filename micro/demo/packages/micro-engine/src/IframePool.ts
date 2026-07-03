/**
 * IframePool — 性能核心模块
 *
 * wujie 每次 mount 都新建 iframe，实测 ~80ms，吃掉路由切换 80% 预算。
 * 池化后 acquire 是 pop 复用，<5ms。
 *
 * 边界：
 *   - 池耗尽 → 现场新建（不阻塞业务，但打 metric 暴露问题）
 *   - release 时池满 → 直接 remove
 *   - 复用前必须 reset（清 DOM / window 变量 / 事件），避免老 app 全局污染
 */

export interface PoolMetrics {
  size: number
  peak: number
  totalCreated: number
  totalReused: number
}

export class IframePool {
  private pool: HTMLIFrameElement[] = []
  private peak = 0
  private totalCreated = 0
  private totalReused = 0

  constructor(private readonly max = 3) {}

  /** 页面加载时调用，预热几个空 iframe 进池 */
  warmup(owner: HTMLElement = document.body): void {
    while (this.pool.length < this.max) {
      this.pool.push(this.create(owner))
    }
    this.peak = Math.max(this.peak, this.pool.length)
  }

  /**
   * 取一个 iframe。优先复用池里的；池空时现场新建（不抛错，仅打 metric）。
   * 这是「Pool 耗尽」边界场景的核心：业务永不被阻塞。
   */
  acquire(owner: HTMLElement = document.body): HTMLIFrameElement {
    const reused = this.pool.pop()
    if (reused) {
      this.totalReused++
      return reused
    }
    return this.create(owner)
  }

  /** 归还 iframe；池满则销毁。重复 release 同一 iframe 不会二次入池。 */
  release(iframe: HTMLIFrameElement): void {
    if (!iframe) return
    if (this.pool.includes(iframe)) return
    if (this.pool.length < this.max) {
      this.resetIframe(iframe)
      this.pool.push(iframe)
      this.peak = Math.max(this.peak, this.pool.length)
    } else {
      iframe.remove()
    }
  }

  /** 销毁池内全部 iframe（teardown 时调用） */
  drain(): void {
    while (this.pool.length) {
      this.pool.pop()!.remove()
    }
  }

  metrics(): PoolMetrics {
    return {
      size: this.pool.length,
      peak: this.peak,
      totalCreated: this.totalCreated,
      totalReused: this.totalReused,
    }
  }

  private create(owner: HTMLElement): HTMLIFrameElement {
    this.totalCreated++
    const iframe = document.createElement('iframe')
    iframe.src = 'about:blank'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText =
      'border:0;width:100%;height:100%;position:absolute;left:-9999px;visibility:hidden'
    owner.appendChild(iframe)
    return iframe
  }

  /**
   * 复用前清理 —— 这是 keep-alive 不爆内存的关键。
   * 老代码可能 setInterval / setTimeout / addEventListener，不清理就是「不可见但活跃」。
   */
  private resetIframe(iframe: HTMLIFrameElement): void {
    const w = iframe.contentWindow
    if (w) {
      try {
        // 清掉可能挂的全局变量（沙箱代理数据）
        delete (w as any).__USER__
        delete (w as any).__AB__
        delete (w as any).__RUM__
        // wujie 模式 patch 还原：池里的 iframe 复用时（vue2/jquery 接手 wujie 用过的 iframe），
        // patch 残留会污染下一个子应用（document.createElement 调主文档、body getter 返回已销毁的 host）
        const uninstall = (w as any).__WUJIE_UNINSTALL__
        if (typeof uninstall === 'function') uninstall()
      } catch {
        /* 跨域 about:blank 不会到这 */
      }
    }
    // 用 about:blank 重置文档，避免上一份子应用 DOM 残留
    try {
      iframe.contentWindow?.location.replace('about:blank')
    } catch {
      /* ignore */
    }
    iframe.removeAttribute('src')
  }
}
