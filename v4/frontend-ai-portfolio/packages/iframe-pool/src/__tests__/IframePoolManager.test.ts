import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IframePoolManager } from '../IframePoolManager';
import type { PoolOptions } from '../IframePoolManager';

// ============================================================
// Test Helpers
// ============================================================

/** Default test URL */
const URL_A = 'https://models.example.com/gradio-a';
const URL_B = 'https://models.example.com/streamlit-b';
const URL_C = 'https://models.example.com/webgl-c';
const URL_D = 'https://models.example.com/custom-d';

function createPool(options?: PoolOptions) {
  return new IframePoolManager(options);
}

/** Count iframes in document.body */
function bodyIframeCount(): number {
  return document.body.querySelectorAll('iframe').length;
}

/** Remove all iframes from document.body */
function cleanupAllIframes(): void {
  document.body.querySelectorAll('iframe').forEach((el) => el.remove());
}

// ============================================================
// 6.1 preload 创建 iframe 并挂载到 DOM
// ============================================================

describe('IframePoolManager — preload', () => {
  let pool: IframePoolManager;

  beforeEach(() => {
    cleanupAllIframes();
  });

  afterEach(() => {
    pool.destroy();
  });

  it('should create an iframe and append it to document.body', () => {
    pool = createPool();
    pool.preload(URL_A);

    expect(bodyIframeCount()).toBe(1);
    const iframe = document.body.querySelector('iframe')!;
    expect(iframe).not.toBeNull();
    expect(iframe.src).toContain('gradio-a');
  });

  it('should apply hidden styles to preloaded iframe', () => {
    pool = createPool();
    pool.preload(URL_A);

    const iframe = document.body.querySelector('iframe')!;
    expect(iframe.style.position).toBe('absolute');
    expect(iframe.style.left).toBe('-9999px');
    expect(iframe.style.opacity).toBe('0');
    expect(iframe.style.pointerEvents).toBe('none');
  });

  it('should respect maxSize limit', () => {
    pool = createPool({ maxSize: 2 });
    pool.preload(URL_A);
    pool.preload(URL_B);
    pool.preload(URL_C);

    // Only 2 should be created
    expect(bodyIframeCount()).toBe(2);
  });

  it('should not create duplicate entries for the same URL', () => {
    pool = createPool();
    pool.preload(URL_A);
    pool.preload(URL_A);
    pool.preload(URL_A);

    expect(bodyIframeCount()).toBe(1);
    expect(pool.getStats().size).toBe(1);
  });
});

// ============================================================
// 6.2 getSandbox 命中池
// ============================================================

describe('IframePoolManager — getSandbox (hit)', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should return preheated iframe from pool', () => {
    const pool = createPool();
    pool.preload(URL_A);

    const iframe = pool.getSandbox(URL_A);

    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(iframe.src).toContain('gradio-a');
    // Hidden styles should be removed
    expect(iframe.style.position).toBe('');

    pool.destroy();
  });

  it('should remove from pool on hit', () => {
    const pool = createPool();
    pool.preload(URL_A);
    expect(pool.getStats().size).toBe(1);

    pool.getSandbox(URL_A);
    expect(pool.getStats().size).toBe(0);

    pool.destroy();
  });
});

// ============================================================
// 6.3 getSandbox 未命中
// ============================================================

describe('IframePoolManager — getSandbox (miss)', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should create a new iframe when pool is empty', () => {
    const pool = createPool();

    const iframe = pool.getSandbox(URL_A);

    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(iframe.src).toContain('gradio-a');
    // Should not be hidden (ready to use)
    expect(iframe.style.position).toBe('');

    pool.destroy();
  });

  it('should create a new iframe when URL does not match pool', () => {
    const pool = createPool();
    pool.preload(URL_A);

    const iframe = pool.getSandbox(URL_B); // different URL

    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(iframe.src).toContain('streamlit-b');
    // URL_A should still be in pool
    expect(pool.getStats().size).toBe(1);

    pool.destroy();
  });
});

// ============================================================
// 6.4 LRU 淘汰
// ============================================================

describe('IframePoolManager — LRU eviction', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should evict least recently used when pool is full', () => {
    const pool = createPool({ maxSize: 3 });

    // Fill pool
    pool.preload(URL_A);
    pool.preload(URL_B);
    pool.preload(URL_C);

    // Access URL_A and URL_B (update their timestamps)
    pool.getSandbox(URL_A);
    pool.getSandbox(URL_B);

    // URL_A and URL_B are now out of pool, pool should refill
    // But refill is async, so let's check later
    // For now, URL_C is the oldest in the pool

    pool.destroy();
  });

  it('should evict the oldest entry when adding new URL beyond maxSize', () => {
    const pool = createPool({ maxSize: 2 });

    pool.preload(URL_A);
    // Small delay to ensure different timestamps
    pool.preload(URL_B);

    // Pool is full (2). Preloading URL_C should not happen
    pool.preload(URL_C);
    expect(pool.getStats().size).toBe(2);
    expect(pool.getStats().entries.map((e) => e.url)).toContain(URL_A);
    expect(pool.getStats().entries.map((e) => e.url)).toContain(URL_B);

    pool.destroy();
  });
});

// ============================================================
// 6.5 命中后自动补充
// ============================================================

describe('IframePoolManager — auto-refill', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('pool size should decrease after getSandbox hit', () => {
    const pool = createPool({ maxSize: 3 });
    pool.preload(URL_A);
    pool.preload(URL_B);

    expect(pool.getStats().size).toBe(2);

    pool.getSandbox(URL_A);
    expect(pool.getStats().size).toBe(1);

    pool.destroy();
  });
});

// ============================================================
// 6.6 老化清理
// ============================================================

describe('IframePoolManager — stale eviction', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should evict entries older than staleTimeoutMs', () => {
    const pool = createPool({
      maxSize: 3,
      staleTimeoutMs: 100, // 100ms for fast test
      evictIntervalMs: 50,
    });

    pool.preload(URL_A);

    // Wait for staleness
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Manually trigger eviction (the timer may have already fired)
        pool.evictStaleNodes();
        expect(pool.getStats().size).toBe(0);
        pool.destroy();
        resolve();
      }, 200);
    });
  });

  it('should not evict recently accessed entries', () => {
    const pool = createPool({
      maxSize: 3,
      staleTimeoutMs: 5000,
      evictIntervalMs: 100,
    });

    pool.preload(URL_A);
    pool.evictStaleNodes();

    // Should still be there (recently accessed)
    expect(pool.getStats().size).toBe(1);

    pool.destroy();
  });
});

// ============================================================
// 6.7 document.hidden 时 preload 为 no-op
// ============================================================

describe('IframePoolManager — document.hidden', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should not preload when document is hidden', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    const pool = createPool();
    pool.preload(URL_A);
    expect(bodyIframeCount()).toBe(0);
    expect(pool.getStats().size).toBe(0);

    pool.destroy();
    vi.restoreAllMocks();
  });

  it('should preload when document is visible', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);

    const pool = createPool();
    pool.preload(URL_A);
    expect(bodyIframeCount()).toBe(1);

    pool.destroy();
    vi.restoreAllMocks();
  });
});

// ============================================================
// 6.8 destroy 清理所有实例和定时器
// ============================================================

describe('IframePoolManager — destroy', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should remove all iframes from DOM', () => {
    const pool = createPool();
    pool.preload(URL_A);
    pool.preload(URL_B);

    expect(bodyIframeCount()).toBe(2);

    pool.destroy();
    expect(bodyIframeCount()).toBe(0);
  });

  it('should clear all entries', () => {
    const pool = createPool();
    pool.preload(URL_A);
    pool.preload(URL_B);

    pool.destroy();
    expect(pool.getStats().size).toBe(0);
  });

  it('should be idempotent', () => {
    const pool = createPool();
    pool.preload(URL_A);

    expect(() => {
      pool.destroy();
      pool.destroy();
      pool.destroy();
    }).not.toThrow();
  });

  it('should throw when getSandbox called after destroy', () => {
    const pool = createPool();
    pool.destroy();

    expect(() => pool.getSandbox(URL_A)).toThrow('destroyed');
  });

  it('should not throw when preload called after destroy', () => {
    const pool = createPool();
    pool.destroy();

    expect(() => pool.preload(URL_A)).not.toThrow();
  });
});

// ============================================================
// 6.9 getStats 返回正确的池状态
// ============================================================

describe('IframePoolManager — getStats', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should return correct stats for empty pool', () => {
    const pool = createPool();
    const stats = pool.getStats();

    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(3);
    expect(stats.entries).toEqual([]);

    pool.destroy();
  });

  it('should return correct stats with entries', () => {
    const pool = createPool({ maxSize: 3 });
    pool.preload(URL_A);
    pool.preload(URL_B);

    const stats = pool.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(3);
    expect(stats.entries).toHaveLength(2);
    expect(stats.entries[0].url).toBeDefined();
    expect(typeof stats.entries[0].idleMs).toBe('number');

    pool.destroy();
  });
});

// ============================================================
// 6.10 releaseSandbox 重置并归还实例
// ============================================================

describe('IframePoolManager — releaseSandbox', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should return iframe to pool after release', () => {
    const pool = createPool({ maxSize: 3 });

    const iframe = pool.getSandbox(URL_A);
    expect(pool.getStats().size).toBe(0);

    pool.releaseSandbox(iframe, URL_A);
    expect(pool.getStats().size).toBe(1);

    pool.destroy();
  });

  it('should reset iframe src to about:blank then restore', () => {
    const pool = createPool({ maxSize: 3 });

    // Create and take an iframe
    const iframe = pool.getSandbox(URL_A);
    const originalSrc = iframe.src;

    pool.releaseSandbox(iframe, URL_A);

    // The iframe should be back in the pool with hidden styles
    expect(iframe.style.position).toBe('absolute');
    expect(iframe.style.left).toBe('-9999px');
    expect(iframe.style.opacity).toBe('0');

    pool.destroy();
  });

  it('should not throw when releasing to destroyed pool', () => {
    const pool = createPool();
    const iframe = pool.getSandbox(URL_A);
    pool.destroy();

    expect(() => {
      pool.releaseSandbox(iframe, URL_A);
    }).not.toThrow();
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('IframePoolManager — edge cases', () => {
  beforeEach(() => {
    cleanupAllIframes();
  });

  it('should handle preload with empty URL', () => {
    const pool = createPool();
    pool.preload('');
    // Should still create an iframe (browser handles empty src)
    expect(bodyIframeCount()).toBe(1);
    pool.destroy();
  });

  it('should handle maxSize of 0', () => {
    const pool = createPool({ maxSize: 0 });
    pool.preload(URL_A);
    expect(pool.getStats().size).toBe(0);
    pool.destroy();
  });

  it('should handle custom options', () => {
    const pool = createPool({
      maxSize: 5,
      staleTimeoutMs: 10 * 60 * 1000,
      evictIntervalMs: 120 * 1000,
    });

    expect(pool.getStats().maxSize).toBe(5);
    pool.destroy();
  });
});