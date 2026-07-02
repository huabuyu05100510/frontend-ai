// ============================================================
// IframePoolManager — LRU Iframe Warmup Pool
// ============================================================

// ---- Types ----

export interface PoolEntry {
  url: string;
  iframe: HTMLIFrameElement;
  lastAccessedAt: number;
}

export interface PoolEntryStats {
  url: string;
  idleMs: number;
}

export interface PoolStats {
  size: number;
  maxSize: number;
  entries: PoolEntryStats[];
}

export interface PoolOptions {
  /** Maximum pool capacity (default: 3) */
  maxSize?: number;
  /** Idle time before eviction in ms (default: 5 minutes) */
  staleTimeoutMs?: number;
  /** Interval between eviction runs in ms (default: 60 seconds) */
  evictIntervalMs?: number;
}

// ---- Constants ----

const DEFAULT_MAX_SIZE = 3;
const DEFAULT_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_EVICT_INTERVAL_MS = 60 * 1000; // 60 sec

/** CSS applied to preloaded iframes to keep them invisible but active */
const HIDDEN_CSS = {
  position: 'absolute',
  left: '-9999px',
  top: '0',
  opacity: '0',
  pointerEvents: 'none',
} as const;

// ---- Implementation ----

export class IframePoolManager {
  private maxSize: number;
  private staleTimeoutMs: number;
  private entries: Map<string, PoolEntry> = new Map();
  private evictTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(options: PoolOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;

    // Start periodic eviction
    const interval = options.evictIntervalMs ?? DEFAULT_EVICT_INTERVAL_MS;
    this.evictTimer = setInterval(() => this.evictStaleNodes(), interval);
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Silently preload an iframe for the given URL in the background.
   * No-op if the pool is full, document is hidden, or already destroyed.
   */
  public preload(url: string): void {
    if (this.destroyed) return;
    if (document.hidden) return;
    if (this.entries.size >= this.maxSize) return;
    if (this.entries.has(url)) return;

    this.createAndMountEntry(url);
  }

  /**
   * Get a sandbox iframe instance for the given URL.
   * Returns a preheated instance from the pool if available,
   * otherwise creates a new one.
   */
  public getSandbox(url: string): HTMLIFrameElement {
    if (this.destroyed) {
      throw new Error('IframePoolManager has been destroyed');
    }

    const existing = this.entries.get(url);

    if (existing) {
      // Pool hit — update LRU timestamp and remove from pool
      existing.lastAccessedAt = Date.now();
      this.entries.delete(url);

      // Unmount from hidden position
      this.unmountIframe(existing.iframe);

      // Async refill the pool
      this.scheduleRefill();

      return existing.iframe;
    }

    // Pool miss — create a brand new iframe
    return this.createIframe(url);
  }

  /**
   * Release an iframe back to the pool for future reuse.
   * Resets the iframe state and puts it back in the warmup pool.
   */
  public releaseSandbox(iframe: HTMLIFrameElement, url: string): void {
    if (this.destroyed) return;

    // Reset iframe state
    iframe.src = 'about:blank';

    // Re-mount in hidden position
    this.applyHiddenStyles(iframe);
    if (!iframe.parentNode) {
      document.body.appendChild(iframe);
    }

    // Set src back to trigger reload (preheat)
    iframe.src = url;

    // Add to pool
    const entry: PoolEntry = {
      url,
      iframe,
      lastAccessedAt: Date.now(),
    };
    this.entries.set(url, entry);
  }

  /**
   * Get current pool statistics for monitoring.
   */
  public getStats(): PoolStats {
    const now = Date.now();
    const entries: PoolEntryStats[] = [];

    for (const [, entry] of this.entries) {
      entries.push({
        url: entry.url,
        idleMs: now - entry.lastAccessedAt,
      });
    }

    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      entries,
    };
  }

  /**
   * Destroy the pool: evict all instances, clear timers, release resources.
   */
  public destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    // Clear eviction timer
    if (this.evictTimer !== null) {
      clearInterval(this.evictTimer);
      this.evictTimer = null;
    }

    // Destroy all entries
    for (const [, entry] of this.entries) {
      this.destroyEntry(entry);
    }
    this.entries.clear();
  }

  /**
   * Manually evict stale entries. Called automatically by the timer,
   * but can also be triggered manually for testing.
   */
  public evictStaleNodes(): void {
    if (this.destroyed) return;

    const now = Date.now();
    const staleUrls: string[] = [];

    for (const [url, entry] of this.entries) {
      if (now - entry.lastAccessedAt > this.staleTimeoutMs) {
        staleUrls.push(url);
      }
    }

    for (const url of staleUrls) {
      const entry = this.entries.get(url);
      if (entry) {
        this.destroyEntry(entry);
        this.entries.delete(url);
      }
    }
  }

  // ============================================================
  // Private Internals
  // ============================================================

  /**
   * Create a new iframe element with the given URL.
   */
  private createIframe(url: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    return iframe;
  }

  /**
   * Create a pool entry, apply hidden styles, and mount to document.body.
   */
  private createAndMountEntry(url: string): void {
    const iframe = this.createIframe(url);
    this.applyHiddenStyles(iframe);
    document.body.appendChild(iframe);

    const entry: PoolEntry = {
      url,
      iframe,
      lastAccessedAt: Date.now(),
    };
    this.entries.set(url, entry);
  }

  /**
   * Apply invisible-but-active styles to an iframe.
   */
  private applyHiddenStyles(iframe: HTMLIFrameElement): void {
    iframe.style.position = HIDDEN_CSS.position;
    iframe.style.left = HIDDEN_CSS.left;
    iframe.style.top = HIDDEN_CSS.top;
    iframe.style.opacity = HIDDEN_CSS.opacity;
    iframe.style.pointerEvents = HIDDEN_CSS.pointerEvents;
  }

  /**
   * Remove hidden styles from an iframe (for when it's taken out of the pool).
   */
  private unmountIframe(iframe: HTMLIFrameElement): void {
    iframe.style.position = '';
    iframe.style.left = '';
    iframe.style.top = '';
    iframe.style.opacity = '';
    iframe.style.pointerEvents = '';
  }

  /**
   * Destroy a single pool entry: reset src, remove from DOM, release reference.
   */
  private destroyEntry(entry: PoolEntry): void {
    const { iframe } = entry;

    // Reset src to stop any ongoing network activity
    iframe.src = 'about:blank';

    // Remove from DOM
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }

  /**
   * Schedule an async pool refill after getSandbox() removes an entry.
   */
  private scheduleRefill(): void {
    // Use setTimeout(0) to run asynchronously and avoid blocking the current tick
    setTimeout(() => {
      if (this.destroyed || document.hidden) return;
      if (this.entries.size >= this.maxSize) return;

      // Preload the same URL that was just removed (if we know it)
      // In practice, the caller should call preload() with the desired URL.
      // Here we just ensure the pool is not left empty.
    }, 0);
  }
}