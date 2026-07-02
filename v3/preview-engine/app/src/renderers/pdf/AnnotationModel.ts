import type { PdfRect, NormRect } from './anchor'

// ============================================================================
// AnnotationModel — 注解类型、创建、命中测试（纯逻辑）
//   所有坐标均为归一化（0~1，页内，原点左上），与渲染分辨率无关。
// ============================================================================

export interface Pt {
  x: number
  y: number
}

export type AnnotationSpec =
  | { type: 'highlight'; rect: PdfRect; color: string }
  | { type: 'rect'; rect: PdfRect; color: string }
  | { type: 'note'; rect: PdfRect; text: string }
  | { type: 'redact'; rect: PdfRect }
  | { type: 'ink'; page: number; points: Pt[]; color: string; width: number }

export type Annotation = AnnotationSpec & {
  id: string
  author: string
  createdAt: number
}

let seq = 0
function genId(): string {
  seq += 1
  return `an_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 8)}`
}

export function createAnnotation(spec: AnnotationSpec, meta: { author: string; now?: number }): Annotation {
  return { ...spec, id: genId(), author: meta.author, createdAt: meta.now ?? Date.now() }
}

export function pointInRect(px: number, py: number, rect: NormRect): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h
}

export function inkBounds(points: Pt[]): NormRect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 注解所在页 */
export function annotationPage(a: Annotation): number {
  return a.type === 'ink' ? a.page : a.rect.page
}

/** 注解的归一化包围盒 */
export function annotationBounds(a: Annotation): NormRect {
  return a.type === 'ink' ? inkBounds(a.points) : a.rect
}

/** 命中测试：返回该页命中点的最上层注解（数组末尾视为最上层） */
export function hitTest(annotations: Annotation[], page: number, px: number, py: number): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]
    if (annotationPage(a) !== page) continue
    if (pointInRect(px, py, annotationBounds(a))) return a
  }
  return null
}
