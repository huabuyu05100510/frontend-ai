/**
 * iframe 池：keep-alive 缓存，避免重复创建销毁
 *
 * 性能优化点：
 *   1. 子应用切换时复用已创建的 iframe（避免 100~500ms 创建延迟）
 *   2. LRU 淘汰：超过 maxSize 时销毁最久未用的 iframe
 *   3. src = 'about:blank' 主动释放子应用内存
 *   4. display: none / block 控制可见性
 *
 * 内存模型：
 *   每个 iframe ≈ 5~20MB（取决于子应用复杂度）
 *   maxSize=3 → 上限 ~60MB（与文档第十四节目标一致）
 */

export interface IframePoolOptions {
  maxSize?: number;
  /** 默认 iframe 高度 */
  defaultHeight?: string;
}

interface PoolEntry {
  iframe: HTMLIFrameElement;
  lastUsedAt: number;
}

export class IframePool {
  private cache = new Map<string, PoolEntry>();
  private readonly maxSize: number;
  private readonly defaultHeight: string;

  constructor(options: IframePoolOptions = {}) {
    this.maxSize = options.maxSize ?? 3;
    this.defaultHeight = options.defaultHeight ?? '100%';
  }

  get size(): number {
    return this.cache.size;
  }

  has(appId: string): boolean {
    return this.cache.has(appId);
  }

  /**
   * 获取或创建 iframe
   * 不存在则创建，存在则更新 LRU
   */
  acquire(appId: string): HTMLIFrameElement {
    const existing = this.cache.get(appId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.iframe;
    }

    // 超过 maxSize 时淘汰最久未用的
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const iframe = document.createElement('iframe');
    iframe.dataset.appId = appId;
    iframe.style.display = 'none';
    iframe.style.width = '100%';
    iframe.style.height = this.defaultHeight;
    iframe.style.border = '0';
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.title = appId;

    // 监听加载事件，错误处理
    iframe.addEventListener('error', () => {
      console.error(`[iframe-pool] ${appId} load error`);
    });

    document.body.appendChild(iframe);

    this.cache.set(appId, {
      iframe,
      lastUsedAt: Date.now(),
    });

    return iframe;
  }

  /**
   * 激活指定子应用（其他自动隐藏）
   */
  activate(appId: string): HTMLIFrameElement | null {
    const entry = this.cache.get(appId);
    if (!entry) return null;

    // 隐藏其他
    for (const [id, e] of this.cache) {
      e.iframe.style.display = id === appId ? 'block' : 'none';
    }

    entry.lastUsedAt = Date.now();
    return entry.iframe;
  }

  /**
   * 销毁指定 iframe
   */
  destroy(appId: string): boolean {
    const entry = this.cache.get(appId);
    if (!entry) return false;

    // ⭐ 关键：先设 src=about:blank 释放子应用内存
    entry.iframe.src = 'about:blank';
    entry.iframe.remove();
    this.cache.delete(appId);
    return true;
  }

  /**
   * 清空所有
   */
  clear(): void {
    for (const appId of Array.from(this.cache.keys())) {
      this.destroy(appId);
    }
  }

  /**
   * LRU 淘汰：销毁最久未用的
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) this.destroy(oldestKey);
  }
}

/**
 * 全局单例（一个 Shell 只有一个池）
 */
export const globalIframePool = new IframePool({ maxSize: 3 });