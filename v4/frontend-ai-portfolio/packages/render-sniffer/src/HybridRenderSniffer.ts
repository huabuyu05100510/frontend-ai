// ============================================================
// HybridRenderSniffer — 3-layer render readiness detection
// ============================================================

import type { IframeBridge } from '../bridge/IframeBridge';

// ---- Types ----

export interface FrameworkProfile {
  type: 'gradio' | 'streamlit' | 'custom';
  /** L2: WebSocket/HTTP URL pattern to watch via PerformanceObserver */
  wsPattern?: RegExp;
  /** L3: DOM selector to watch via MutationObserver */
  domSelector?: string;
  /** L3: Minimum child count under selector to consider "ready" */
  domMinChildren?: number;
}

export type SnifferResult =
  | { level: 'L1'; reason: 'bridge_signal' }
  | { level: 'L2'; reason: 'ws_handshake'; matchedUrl: string }
  | { level: 'L3'; reason: 'dom_ready'; selector: string; childCount: number }
  | { level: 'TIMEOUT'; reason: 'all_layers_exhausted' };

export interface SnifferOptions {
  l2TimeoutMs?: number;
  l3TimeoutMs?: number;
}

// ---- Constants ----

const DEFAULT_L2_TIMEOUT_MS = 30_000; // 30s
const DEFAULT_L3_TIMEOUT_MS = 15_000; // 15s

// Pre-built profiles
export const PROFILES: Record<string, FrameworkProfile> = {
  gradio: {
    type: 'gradio',
    wsPattern: /queue\/join/,
    domSelector: '.gradio-container',
    domMinChildren: 1,
  },
  streamlit: {
    type: 'streamlit',
    wsPattern: /_stcore\/stream/,
    domSelector: '.stApp',
    domMinChildren: 1,
  },
  custom: {
    type: 'custom',
    // L2 unavailable for custom, L3 only
    domSelector: undefined,
    domMinChildren: 0,
  },
};

// ---- Implementation ----

export class HybridRenderSniffer {
  private onRendered: (result: SnifferResult) => void;
  private profile: FrameworkProfile;
  private options: Required<SnifferOptions>;
  private iframeWindow: Window;

  private resolved = false;
  private performanceObserver: PerformanceObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private l2Timer: ReturnType<typeof setTimeout> | null = null;
  private l3Timer: ReturnType<typeof setTimeout> | null = null;
  private bridgeHandler: (() => void) | null = null;

  constructor(
    iframeWindow: Window,
    profile: FrameworkProfile,
    onRendered: (result: SnifferResult) => void,
    bridge?: IframeBridge,
    options?: SnifferOptions,
  ) {
    this.iframeWindow = iframeWindow;
    this.profile = profile;
    this.onRendered = onRendered;
    this.options = {
      l2TimeoutMs: options?.l2TimeoutMs ?? DEFAULT_L2_TIMEOUT_MS,
      l3TimeoutMs: options?.l3TimeoutMs ?? DEFAULT_L3_TIMEOUT_MS,
    };

    this.setupLevels(bridge);
  }

  /**
   * Abort all detection. No onRendered call will be made.
   */
  public abort(): void {
    this.cleanup();
  }

  // ============================================================
  // Setup
  // ============================================================

  private setupLevels(bridge?: IframeBridge): void {
    this.setupL1(bridge);
    this.setupL2();
    this.setupL3();
  }

  /**
   * L1: Bridge SDK active signal — `app.ready` notification.
   */
  private setupL1(bridge?: IframeBridge): void {
    if (!bridge) return;

    this.bridgeHandler = () => {
      this.resolve({ level: 'L1', reason: 'bridge_signal' });
    };
    bridge.on('app.ready', this.bridgeHandler);
  }

  /**
   * L2: PerformanceObserver watching for WebSocket/HTTP resource timing.
   * Auto-degrades if cross-origin without Timing-Allow-Origin.
   */
  private setupL2(): void {
    if (!this.profile.wsPattern) return;

    try {
      // Check if we can access performance entries from the iframe
      const entries = this.iframeWindow.performance.getEntriesByType('resource');
      if (entries.length === 0) {
        // Iframe may not have loaded yet — set up observer anyway
      }

      this.performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Check if timing data is available (not cross-origin blocked)
          const timing = (entry as PerformanceResourceTiming);
          if (timing.transferSize === 0 && timing.duration === 0) {
            // Cross-origin blocked — silently degrade
            continue;
          }

          if (this.profile.wsPattern!.test(entry.name)) {
            this.resolve({
              level: 'L2',
              reason: 'ws_handshake',
              matchedUrl: entry.name,
            });
            return;
          }
        }
      });

      this.performanceObserver.observe({
        type: 'resource',
        buffered: true,
      });

      // L2 timeout
      this.l2Timer = setTimeout(() => {
        // L2 timeout — not a failure, just degraded
      }, this.options.l2TimeoutMs);
    } catch {
      // PerformanceObserver not available or cross-origin blocked
      // Silently degrade to L3
    }
  }

  /**
   * L3: MutationObserver watching for specific DOM selector.
   */
  private setupL3(): void {
    if (!this.profile.domSelector) return;

    // Try immediate check
    this.checkDom();

    this.mutationObserver = new MutationObserver(() => {
      this.checkDom();
    });

    try {
      this.mutationObserver.observe(this.iframeWindow.document.body, {
        childList: true,
        subtree: true,
      });
    } catch {
      // Cross-origin access blocked — DOM observation unavailable
    }

    // L3 timeout
    this.l3Timer = setTimeout(() => {
      if (!this.resolved) {
        this.resolve({ level: 'TIMEOUT', reason: 'all_layers_exhausted' });
      }
    }, this.options.l3TimeoutMs);
  }

  private checkDom(): void {
    if (!this.profile.domSelector || this.resolved) return;

    try {
      const el = this.iframeWindow.document.querySelector(this.profile.domSelector);
      if (el) {
        const minChildren = this.profile.domMinChildren ?? 1;
        if (el.children.length >= minChildren || el.childNodes.length >= minChildren) {
          this.resolve({
            level: 'L3',
            reason: 'dom_ready',
            selector: this.profile.domSelector!,
            childCount: el.children.length,
          });
        }
      }
    } catch {
      // Cross-origin — ignore
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  private resolve(result: SnifferResult): void {
    if (this.resolved) return;
    this.resolved = true;
    this.cleanup();
    this.onRendered(result);
  }

  private cleanup(): void {
    // Disconnect observers
    this.performanceObserver?.disconnect();
    this.performanceObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;

    // Clear timers
    if (this.l2Timer !== null) { clearTimeout(this.l2Timer); this.l2Timer = null; }
    if (this.l3Timer !== null) { clearTimeout(this.l3Timer); this.l3Timer = null; }
  }
}