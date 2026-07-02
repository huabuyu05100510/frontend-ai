/**
 * 文档渲染器 — pdfium-wasm Web Worker 封装
 *
 * 在 Worker 线程中渲染 PDF 页面，通过 postMessage 返回 ImageBitmap。
 * 虚拟页面池：最多维护 6 页，LRU 淘汰，超出调用 bitmap.close()。
 *
 * @module renderers/DocumentRenderer
 */

import type { TextItem, PDFWorkerMessage, PDFWorkerResponse } from '../core/types';

/** 最大页面池大小 */
const MAX_POOL_SIZE = 6;

/** 单页 ImageBitmap 最大大小（bytes） */
const MAX_PAGE_BYTES = 50 * 1024 * 1024; // 50MB

/** 降级渲染分辨率比例 */
const DOWNGRADE_SCALE = 0.5;

interface PageEntry {
  pageIndex: number;
  bitmap: ImageBitmap;
  textItems: TextItem[];
  lastAccess: number;
  scale: number;
}

type PageCallback = (page: PageEntry) => void;
type ErrorCallback = (error: Error) => void;

/**
 * 文档渲染器
 *
 * 封装 pdfium-wasm Worker 通信，提供虚拟页面池管理。
 *
 * @example
 * ```ts
 * const renderer = new DocumentRenderer(workerScript);
 * renderer.onPage((page) => {
 *   ctx.drawImage(page.bitmap, 0, 0);
 * });
 * await renderer.load(documentBuffer);
 * await renderer.renderPage(0);
 * ```
 */
export class DocumentRenderer {
  private worker: Worker | null = null;
  private pool = new Map<number, PageEntry>();
  private pageCallbacks = new Set<PageCallback>();
  private errorCallbacks = new Set<ErrorCallback>();
  private totalPages = 0;
  private destroyed = false;

  constructor(workerScript: string | URL) {
    this.worker = new Worker(workerScript);
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = (e) => {
      for (const cb of this.errorCallbacks) {
        cb(new Error(`Worker error: ${e.message}`));
      }
    };
  }

  /**
   * 加载文档
   */
  async load(buffer: ArrayBuffer): Promise<void> {
    this.postMessage({ type: 'render', buffer });
  }

  /**
   * 渲染指定页面
   */
  async renderPage(pageIndex: number, scale = 1): Promise<void> {
    this.postMessage({ type: 'render', pages: [pageIndex], scale });
  }

  /**
   * 渲染页面范围
   */
  async renderPageRange(start: number, end: number, scale = 1): Promise<void> {
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    this.postMessage({ type: 'render', pages, scale });
  }

  /**
   * 获取页面（从缓存）
   */
  getPage(pageIndex: number): PageEntry | undefined {
    const entry = this.pool.get(pageIndex);
    if (entry) {
      entry.lastAccess = Date.now();
    }
    return entry;
  }

  /**
   * 订阅页面渲染完成
   */
  onPage(cb: PageCallback): () => void {
    this.pageCallbacks.add(cb);
    return () => { this.pageCallbacks.delete(cb); };
  }

  /**
   * 订阅错误
   */
  onError(cb: ErrorCallback): () => void {
    this.errorCallbacks.add(cb);
    return () => { this.errorCallbacks.delete(cb); };
  }

  /** 获取总页数 */
  getTotalPages(): number {
    return this.totalPages;
  }

  /**
   * 取消待渲染任务
   */
  cancel(): void {
    this.postMessage({ type: 'cancel' });
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.destroyed = true;
    this.cancel();

    // 释放所有缓存的 ImageBitmap
    for (const entry of this.pool.values()) {
      entry.bitmap.close();
    }
    this.pool.clear();

    this.worker?.terminate();
    this.worker = null;
    this.pageCallbacks.clear();
    this.errorCallbacks.clear();
  }

  // ---- 内部 ----

  private postMessage(msg: PDFWorkerMessage): void {
    if (this.destroyed || !this.worker) return;
    this.worker.postMessage(msg);
  }

  private handleMessage(e: MessageEvent<PDFWorkerResponse>): void {
    const data = e.data;

    if (data.type === 'progress') {
      this.totalPages = data.total ?? 0;
      return;
    }

    if (data.type === 'error') {
      for (const cb of this.errorCallbacks) {
        cb(new Error(data.error ?? 'Unknown error'));
      }
      return;
    }

    if (data.type === 'page' && data.pageIndex !== undefined && data.bitmap) {
      this.addToPool(data.pageIndex, data.bitmap, data.textItems ?? [], data.total ?? 0);
    }
  }

  private addToPool(
    pageIndex: number,
    bitmap: ImageBitmap,
    textItems: TextItem[],
    total: number,
  ): void {
    this.totalPages = total;

    let finalBitmap = bitmap;
    let finalScale = 1;

    // 大页面降级
    const bytes = bitmap.width * bitmap.height * 4;
    if (bytes > MAX_PAGE_BYTES) {
      finalScale = DOWNGRADE_SCALE;
      console.warn(
        `[DocumentRenderer] page ${pageIndex} downgraded to ${DOWNGRADE_SCALE}x (${(bytes / 1024 / 1024).toFixed(1)}MB)`,
      );
      // 降级由 Worker 侧处理，此处仅记录
    }

    const entry: PageEntry = {
      pageIndex,
      bitmap: finalBitmap,
      textItems,
      lastAccess: Date.now(),
      scale: finalScale,
    };

    // LRU 淘汰
    if (this.pool.size >= MAX_POOL_SIZE) {
      this.evictLRU();
    }

    this.pool.set(pageIndex, entry);

    // 通知订阅者
    for (const cb of this.pageCallbacks) {
      cb(entry);
    }
  }

  private evictLRU(): void {
    let oldest: PageEntry | null = null;

    for (const entry of this.pool.values()) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) {
        oldest = entry;
      }
    }

    if (oldest) {
      oldest.bitmap.close();
      this.pool.delete(oldest.pageIndex);
    }
  }
}