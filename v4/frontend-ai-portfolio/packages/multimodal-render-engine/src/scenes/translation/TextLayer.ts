/**
 * 透明可复制文字层
 *
 * 在 Canvas 之上叠加透明 DOM 文字，实现原生文本选择和复制。
 * selectionchange 时短暂显示文字层以展示选区高亮。
 *
 * @module scenes/translation/TextLayer
 */

import type { TextItem } from '../../core/types';
import { calcScaleXCorrection } from '../../utils/measure';

/**
 * 构建透明文字层
 *
 * @param items 文本项列表
 * @param scale Canvas 显示缩放比
 * @returns 文字层 DOM 元素
 */
export function buildTextLayer(
  items: TextItem[],
  scale: number,
): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'text-layer';
  layer.setAttribute('data-text-layer', 'true');
  layer.style.cssText =
    'position:absolute;inset:0;overflow:hidden;opacity:0;user-select:text;pointer-events:all;z-index:2;';

  for (const item of items) {
    const span = document.createElement('span');
    span.textContent = item.text;

    const left = item.bbox.x * scale;
    const top = item.bbox.y * scale;
    const fontSize = item.fontSize * scale;
    const targetWidth = item.bbox.w * scale;
    const scaleX = calcScaleXCorrection(
      item.text,
      fontSize,
      targetWidth,
      item.fontFamily,
    );

    span.style.cssText =
      `position:absolute;` +
      `left:${left}px;` +
      `top:${top}px;` +
      `font-size:${fontSize}px;` +
      `font-family:${item.fontFamily ?? 'sans-serif'};` +
      `white-space:pre;` +
      `transform:scaleX(${scaleX});` +
      `transform-origin:0 0;` +
      `color:transparent;`;

    layer.appendChild(span);
  }

  // selectionchange 事件：有选区时显示文字层，无选区时隐藏
  const handleSelectionChange = (): void => {
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed;

    // 检查选区是否在当前文字层内
    if (hasSelection && selection && layer.contains(selection.anchorNode)) {
      // opacity: 0.0001 — 选区高亮可见，但文字不遮挡 Canvas
      layer.style.opacity = '0.0001';
    } else {
      layer.style.opacity = '0';
    }
  };

  document.addEventListener('selectionchange', handleSelectionChange);

  // 返回清理函数
  (layer as any).__cleanup = () => {
    document.removeEventListener('selectionchange', handleSelectionChange);
  };

  return layer;
}

/**
 * 销毁文字层（移除事件监听）
 */
export function destroyTextLayer(layer: HTMLDivElement): void {
  if ((layer as any).__cleanup) {
    (layer as any).__cleanup();
  }
  layer.remove();
}