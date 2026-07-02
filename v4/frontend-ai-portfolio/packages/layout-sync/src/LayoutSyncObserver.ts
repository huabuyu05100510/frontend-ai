// ============================================================
// LayoutSyncObserver — Bidirectional resize sync with anti-loop
// ============================================================

import type { IframeBridge } from '../bridge/IframeBridge';

export interface LayoutSyncConfig {
  /** Change threshold in px (default: 5) */
  thresholdPx: number;
  /** Force sync after this many consecutive skips (default: 3) */
  forceSyncAfterSkips: number;
  /** Debounce delay in ms (default: 16, ~1 frame) */
  debounceMs: number;
}

const DEFAULT_CONFIG: LayoutSyncConfig = {
  thresholdPx: 5,
  forceSyncAfterSkips: 3,
  debounceMs: 16,
};

export class LayoutSyncObserver {
  private config: LayoutSyncConfig;
  private rafId: number | null = null;
  private lastWidth: number | null = null;
  private lastHeight: number | null = null;
  private skipCounter = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnected = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(config?: Partial<LayoutSyncConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Host side: watch container element and push width changes to Guest.
   */
  public observeHost(containerEl: HTMLElement, bridge: IframeBridge): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.scheduleSync(() => {
          bridge.notify('layout.resize', {
            width: Math.round(width),
            height: Math.round(height),
          });
        }, Math.round(width), Math.round(height));
      }
    });

    this.resizeObserver.observe(containerEl);
  }

  /**
   * Guest side: watch document.body and push height changes to Host.
   */
  public observeGuest(bridge: IframeBridge): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height } = entry.contentRect;
        this.scheduleSync(() => {
          bridge.notify('layout.contentHeight', {
            height: Math.round(height),
          });
        }, null, Math.round(height));
      }
    });

    this.resizeObserver.observe(document.body);
  }

  /**
   * Stop all observation.
   */
  public disconnect(): void {
    this.disconnected = true;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ============================================================
  // Private
  // ============================================================

  private scheduleSync(
    callback: () => void,
    newWidth: number | null,
    newHeight: number | null,
  ): void {
    if (this.disconnected) return;

    // Debounce: clear previous pending sync
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      // RAF: merge multiple triggers in the same frame
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
      }

      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.debounceTimer = null;

        if (this.shouldSync(newWidth, newHeight)) {
          callback();
          this.skipCounter = 0;
        }
      });
    }, this.config.debounceMs);
  }

  private shouldSync(newWidth: number | null, newHeight: number | null): boolean {
    const widthDiff = newWidth !== null && this.lastWidth !== null
      ? Math.abs(newWidth - this.lastWidth)
      : Infinity;
    const heightDiff = newHeight !== null && this.lastHeight !== null
      ? Math.abs(newHeight - this.lastHeight)
      : Infinity;

    const belowThreshold = widthDiff < this.config.thresholdPx && heightDiff < this.config.thresholdPx;

    if (belowThreshold) {
      this.skipCounter++;

      // Force sync after N consecutive skips
      if (this.skipCounter >= this.config.forceSyncAfterSkips) {
        this.updateLast(newWidth, newHeight);
        return true;
      }
      return false;
    }

    this.updateLast(newWidth, newHeight);
    return true;
  }

  private updateLast(width: number | null, height: number | null): void {
    if (width !== null) this.lastWidth = width;
    if (height !== null) this.lastHeight = height;
  }
}