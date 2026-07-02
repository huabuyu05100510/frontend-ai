// ============================================================
// MicroAppContainer — Top-level iframe app lifecycle manager
// ============================================================

import { IframeBridge } from '../bridge/IframeBridge';
import { IframePoolManager } from '../pool/IframePoolManager';
import { LayoutSyncObserver } from '../layout-sync/LayoutSyncObserver';
import { HybridRenderSniffer } from '../render-sniffer/HybridRenderSniffer';
import type { FrameworkProfile, SnifferResult } from '../render-sniffer/HybridRenderSniffer';

// ---- Types ----

export type ContainerState = 'IDLE' | 'LOADING' | 'SNIFFING' | 'RENDERED' | 'ERROR';

export interface ContainerOptions {
  /** Target origin for postMessage */
  targetOrigin?: string;
  /** Framework profile for sniffer */
  profile?: FrameworkProfile;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatMs?: number;
  /** Max consecutive heartbeat failures before crash recovery (default: 2) */
  maxHeartbeatFailures?: number;
  /** Skeleton timeout in ms (default: 10000) */
  skeletonTimeoutMs?: number;
}

// ---- Constants ----

const SKELETON_FADE_DURATION_MS = 300;
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_MAX_HEARTBEAT_FAILURES = 2;
const DEFAULT_SKELETON_TIMEOUT_MS = 10_000;

// ---- CSS Snippets ----

const CONTAINER_CSS = `
  min-height: 200px;
  contain: layout style;
  position: relative;
`;

const IFRAME_CSS = `
  width: 100%;
  border: none;
  display: block;
`;

const SKELETON_CSS = `
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  transition: opacity ${SKELETON_FADE_DURATION_MS}ms ease-out;
`;

const SKELETON_KEYFRAMES = `
  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

// ---- Implementation ----

export class MicroAppContainer {
  private containerEl: HTMLDivElement;
  private iframe: HTMLIFrameElement | null = null;
  private skeletonEl: HTMLDivElement | null = null;
  private errorEl: HTMLDivElement | null = null;

  private bridge: IframeBridge | null = null;
  private pool: IframePoolManager;
  private layoutSync: LayoutSyncObserver;
  private sniffer: HybridRenderSniffer | null = null;

  private state: ContainerState = 'IDLE';
  private options: Required<ContainerOptions>;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatFailures = 0;
  private skeletonTimer: ReturnType<typeof setTimeout> | null = null;

  private stateListeners: Array<(state: ContainerState) => void> = [];

  constructor(
    containerEl: HTMLDivElement,
    options: ContainerOptions = {},
  ) {
    this.containerEl = containerEl;
    this.options = {
      targetOrigin: options.targetOrigin ?? '*',
      profile: options.profile ?? { type: 'custom' },
      heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      maxHeartbeatFailures: options.maxHeartbeatFailures ?? DEFAULT_MAX_HEARTBEAT_FAILURES,
      skeletonTimeoutMs: options.skeletonTimeoutMs ?? DEFAULT_SKELETON_TIMEOUT_MS,
    };

    // Apply container CSS
    this.containerEl.style.cssText = CONTAINER_CSS;
    this.pool = new IframePoolManager();
    this.layoutSync = new LayoutSyncObserver();

    // Inject skeleton keyframes
    this.injectKeyframes();
  }

  /**
   * Subscribe to state changes.
   */
  public onStateChange(listener: (state: ContainerState) => void): void {
    this.stateListeners.push(listener);
  }

  /**
   * Get current state.
   */
  public getState(): ContainerState {
    return this.state;
  }

  /**
   * Load a model application.
   */
  public async load(url: string): Promise<void> {
    this.transition('LOADING');

    // Show skeleton
    this.showSkeleton();

    // Get iframe from pool or create new
    try {
      this.iframe = this.pool.getSandbox(url);
    } catch {
      this.iframe = document.createElement('iframe');
      this.iframe.src = url;
    }

    this.iframe.style.cssText = IFRAME_CSS;
    this.containerEl.appendChild(this.iframe);

    // Create Bridge
    this.bridge = new IframeBridge(
      this.iframe.contentWindow!,
      this.options.targetOrigin,
    );

    // === Flow Layout: listen for Guest content height and adjust container ===
    this.bridge.on('layout.contentHeight', (params: any) => {
      if (this.iframe && params?.height) {
        const h = Math.round(params.height);
        this.iframe.style.height = h + 'px';
        this.containerEl.style.height = h + 'px';
        // Also adjust skeleton to match
        if (this.skeletonEl) {
          this.skeletonEl.style.height = h + 'px';
        }
      }
    });

    // Start layout sync (Host → Guest width)
    this.layoutSync.observeHost(this.containerEl, this.bridge);

    // Start skeleton timeout
    this.skeletonTimer = setTimeout(() => {
      if (this.state === 'SNIFFING' || this.state === 'LOADING') {
        this.onRendered({ level: 'TIMEOUT', reason: 'all_layers_exhausted' });
      }
    }, this.options.skeletonTimeoutMs);

    // Start sniffing
    this.transition('SNIFFING');
    this.sniffer = new HybridRenderSniffer(
      this.iframe.contentWindow!,
      this.options.profile,
      (result) => this.onRendered(result),
      this.bridge,
      { l2TimeoutMs: 30_000, l3TimeoutMs: 15_000 },
    );

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Retry after error.
   */
  public async retry(url: string): Promise<void> {
    this.destroy();
    await this.load(url);
  }

  /**
   * Destroy the container and release resources.
   */
  public destroy(): void {
    this.stopHeartbeat();

    if (this.skeletonTimer) {
      clearTimeout(this.skeletonTimer);
      this.skeletonTimer = null;
    }

    this.sniffer?.abort();
    this.sniffer = null;
    this.layoutSync.disconnect();
    this.bridge?.destroy();
    this.bridge = null;

    this.removeSkeleton();
    this.removeError();

    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    this.heartbeatFailures = 0;
    this.transition('IDLE');
  }

  // ============================================================
  // Private
  // ============================================================

  private transition(newState: ContainerState): void {
    this.state = newState;
    for (const listener of this.stateListeners) {
      listener(newState);
    }
  }

  private onRendered(result: SnifferResult): void {
    if (this.skeletonEl) {
      // Start fade-out
      this.skeletonEl.style.opacity = '0';

      this.skeletonEl.addEventListener('transitionend', () => {
        this.removeSkeleton();
      }, { once: true });
    }

    this.transition('RENDERED');
  }

  // ---- Skeleton ----

  private showSkeleton(): void {
    this.removeSkeleton();

    const skeleton = document.createElement('div');
    skeleton.className = 'orbit-skeleton';
    skeleton.style.cssText = SKELETON_CSS;
    this.containerEl.appendChild(skeleton);
    this.skeletonEl = skeleton;
  }

  private removeSkeleton(): void {
    this.skeletonEl?.remove();
    this.skeletonEl = null;
  }

  // ---- Error ----

  private showError(message: string, onRetry: () => void): void {
    this.removeError();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'orbit-error';
    errorDiv.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #fff;
      z-index: 20;
      font-family: system-ui, sans-serif;
    `;

    errorDiv.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
      <div style="font-size: 16px; color: #666; margin-bottom: 24px;">${message}</div>
      <button id="orbit-retry-btn" style="
        padding: 10px 24px;
        font-size: 14px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
        color: #333;
      ">🔄 重试</button>
    `;

    this.containerEl.appendChild(errorDiv);
    this.errorEl = errorDiv;

    errorDiv.querySelector('#orbit-retry-btn')?.addEventListener('click', onRetry);
  }

  private removeError(): void {
    this.errorEl?.remove();
    this.errorEl = null;
  }

  // ---- Heartbeat ----

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(async () => {
      if (!this.bridge) return;

      try {
        await this.bridge.request('app.health', {}, 3000);
        this.heartbeatFailures = 0;
      } catch {
        this.heartbeatFailures++;

        if (this.heartbeatFailures >= this.options.maxHeartbeatFailures) {
          this.handleCrash();
        }
      }
    }, this.options.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleCrash(): void {
    console.warn('[Orbit] App crash detected, recovering...');
    this.stopHeartbeat();
    this.transition('ERROR');
    this.showError('应用已崩溃，点击重试恢复', () => {
      this.removeError();
      this.retry(this.iframe?.src ?? '');
    });
  }

  private injectKeyframes(): void {
    if (document.getElementById('orbit-keyframes')) return;

    const style = document.createElement('style');
    style.id = 'orbit-keyframes';
    style.textContent = SKELETON_KEYFRAMES;
    document.head.appendChild(style);
  }
}