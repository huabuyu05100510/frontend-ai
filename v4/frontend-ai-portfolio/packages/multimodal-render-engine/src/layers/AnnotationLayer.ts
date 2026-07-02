/**
 * 标注层挂载管理
 *
 * 管理 SVGLayer 的生命周期，在场景组件 mount/unmount 时自动挂载/卸载。
 *
 * @module layers/AnnotationLayer
 */

import type { SVGLayerAPI } from '../core/types';

/**
 * 标注层管理器
 */
export class AnnotationLayer {
  private layers: SVGLayerAPI[] = [];

  /** 注册标注层 */
  register(layer: SVGLayerAPI): void {
    this.layers.push(layer);
  }

  /** 取消注册 */
  unregister(layer: SVGLayerAPI): void {
    this.layers = this.layers.filter(l => l !== layer);
  }

  /** 在所有层上高亮 */
  highlightAll(id: string, on: boolean, mode?: 'hover' | 'selected'): void {
    for (const layer of this.layers) {
      layer.setHighlight(id, on, mode);
    }
  }

  /** 清空所有层 */
  clearAll(): void {
    for (const layer of this.layers) {
      layer.clear();
    }
  }

  /** 销毁 */
  destroy(): void {
    this.clearAll();
    this.layers = [];
  }
}