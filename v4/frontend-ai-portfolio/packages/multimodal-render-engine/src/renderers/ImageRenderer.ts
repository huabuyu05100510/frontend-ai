/**
 * 图片渲染器
 *
 * 创建 <img> 元素并管理加载状态。
 * 提供 naturalSize / displayScale / containerBCR 等查询。
 *
 * @module renderers/ImageRenderer
 */

import type { Size } from '../core/types';

type LoadCallback = () => void;

/**
 * 图片渲染器
 */
export class ImageRenderer {
  private imgElement: HTMLImageElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private loadCallbacks = new Set<LoadCallback>();

  constructor(private readonly container: HTMLElement) {}

  /**
   * 加载图片文件
   */
  async load(file: File): Promise<void> {
    // 清理旧图片
    this.cleanup();

    const url = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.style.cssText = 'max-width:100%;object-fit:contain;display:block;';

      img.onload = () => {
        this.imgElement = img;
        this.container.appendChild(img);

        // 设置 ResizeObserver
        this.resizeObserver = new ResizeObserver(() => {
          for (const cb of this.loadCallbacks) cb();
        });
        this.resizeObserver.observe(this.container);

        resolve();
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };

      img.src = url;
    });
  }

  /** 获取图片原始尺寸 */
  getNaturalSize(): Size {
    if (!this.imgElement) {
      return { width: 0, height: 0 };
    }
    return {
      width: this.imgElement.naturalWidth,
      height: this.imgElement.naturalHeight,
    };
  }

  /** 获取当前显示缩放比 */
  getDisplayScale(): number {
    if (!this.imgElement || !this.imgElement.naturalWidth) return 1;
    return this.container.offsetWidth / this.imgElement.naturalWidth;
  }

  /** 获取容器的 BoundingClientRect */
  getContainerBCR(): DOMRect {
    return this.container.getBoundingClientRect();
  }

  /** 获取 img 元素 */
  getImgElement(): HTMLImageElement | null {
    return this.imgElement;
  }

  /** 订阅 resize 事件 */
  onResize(cb: LoadCallback): () => void {
    this.loadCallbacks.add(cb);
    return () => { this.loadCallbacks.delete(cb); };
  }

  /** 销毁 */
  destroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.loadCallbacks.clear();

    if (this.imgElement) {
      if (this.imgElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.imgElement.src);
      }
      this.imgElement.remove();
      this.imgElement = null;
    }
  }
}