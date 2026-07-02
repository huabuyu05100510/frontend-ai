/**
 * SVG 标注层工厂
 *
 * 在 SVG 元素上绘制所有标注视觉元素：
 * - 波浪线（智检错误）
 * - 矩形框（OCR 识别区域）
 * - 文字标签（字段名/序号）
 * - 高亮状态（hover/selected）
 * - resize 控制点（8个方向）
 * - 预览矩形（拖拽时虚线框）
 *
 * 所有标注元素挂在 g[data-id] 容器下，便于整组管理。
 *
 * @module layers/SVGLayer
 */

import type { BoxStyle, Rect, SVGLayerAPI } from '../core/types';
import {
  createWavyPath,
  createAnnotationRect,
  createTextLabel,
  createResizeHandle,
  createPreviewRect,
  createSVGElement,
  setAttrs,
} from '../utils/svg';

/** 高亮 class 常量 */
const HIGHLIGHT_HOVER = 'highlight-hover';
const HIGHLIGHT_SELECTED = 'highlight-selected';

/**
 * SVG 标注层
 */
export class SVGLayer implements SVGLayerAPI {
  private readonly svg: SVGSVGElement;
  private readonly groups = new Map<string, SVGGElement>();
  private previewRect: SVGRectElement | null = null;
  private resizeHandles: SVGCircleElement[] = [];

  constructor(svgEl: SVGSVGElement) {
    this.svg = svgEl;
  }

  // ---- 波浪线 ----

  addWavyUnderline(id: string, rects: readonly DOMRect[], color: string): void {
    const group = this.getOrCreateGroup(id);

    for (const rect of rects) {
      const y = rect.bottom + 2;
      const path = createWavyPath(rect.x, y, rect.width, color);
      group.appendChild(path);
    }
  }

  // ---- 标注框 ----

  addAnnotationBox(id: string, rect: DOMRect, style: BoxStyle): void {
    const group = this.getOrCreateGroup(id);

    const box = createAnnotationRect(rect, {
      strokeColor: style.strokeColor,
      fillColor: style.fillColor,
      strokeWidth: style.strokeWidth,
      borderRadius: style.borderRadius,
    });
    group.appendChild(box);
  }

  // ---- 文字标签 ----

  addTextLabel(id: string, rect: DOMRect, text: string, color?: string): void {
    const group = this.getOrCreateGroup(id);

    // 移除旧 label
    const oldLabel = group.querySelector('text');
    if (oldLabel) oldLabel.remove();

    const label = createTextLabel(rect, text, color ?? '#1890ff');
    group.appendChild(label);
  }

  // ---- 高亮 ----

  setHighlight(id: string, on: boolean, mode?: 'hover' | 'selected'): void {
    const group = this.groups.get(id);
    if (!group) return;

    if (on) {
      const cls = mode === 'selected' ? HIGHLIGHT_SELECTED : HIGHLIGHT_HOVER;
      group.classList.add(cls);
    } else {
      group.classList.remove(HIGHLIGHT_HOVER, HIGHLIGHT_SELECTED);
    }
  }

  // ---- Resize 控制点 ----

  showResizeHandles(id: string): void {
    this.hideResizeHandles();

    const group = this.groups.get(id);
    if (!group) return;

    // 获取框的 bbox
    const rect = group.querySelector('rect');
    if (!rect) return;

    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const w = parseFloat(rect.getAttribute('width') || '0');
    const h = parseFloat(rect.getAttribute('height') || '0');

    const handles = [
      [x, y],           // 0: NW
      [x + w / 2, y],   // 1: N
      [x + w, y],       // 2: NE
      [x + w, y + h / 2], // 3: E
      [x + w, y + h],   // 4: SE
      [x + w / 2, y + h], // 5: S
      [x, y + h],       // 6: SW
      [x, y + h / 2],   // 7: W
    ];

    const handlesGroup = createSVGElement('g', { class: 'resize-handles' });

    for (let i = 0; i < handles.length; i++) {
      const handle = createResizeHandle(handles[i][0], handles[i][1], i);
      handlesGroup.appendChild(handle);
      this.resizeHandles.push(handle);
    }

    this.svg.appendChild(handlesGroup);
  }

  hideResizeHandles(): void {
    const handlesGroup = this.svg.querySelector('.resize-handles');
    if (handlesGroup) handlesGroup.remove();
    this.resizeHandles = [];
  }

  // ---- 预览矩形 ----

  showPreviewRect(rect: Rect): void {
    this.hidePreviewRect();
    this.previewRect = createPreviewRect(rect);
    this.svg.appendChild(this.previewRect);
  }

  updatePreviewRect(rect: Rect): void {
    if (this.previewRect) {
      setAttrs(this.previewRect, {
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      });
    }
  }

  hidePreviewRect(): void {
    if (this.previewRect) {
      this.previewRect.remove();
      this.previewRect = null;
    }
  }

  // ---- 管理 ----

  remove(id: string): void {
    const group = this.groups.get(id);
    if (group) {
      group.remove();
      this.groups.delete(id);
    }
  }

  clear(): void {
    for (const group of this.groups.values()) {
      group.remove();
    }
    this.groups.clear();
    this.hidePreviewRect();
    this.hideResizeHandles();
  }

  /** 获取某个标注组（调试用） */
  getGroup(id: string): SVGGElement | undefined {
    return this.groups.get(id);
  }

  // ---- 内部 ----

  private getOrCreateGroup(id: string): SVGGElement {
    let group = this.groups.get(id);
    if (!group) {
      group = createSVGElement('g', { 'data-id': id });
      this.svg.appendChild(group);
      this.groups.set(id, group);
    }
    return group;
  }
}