import type { Annotation } from './AnnotationModel'

// ============================================================================
// exportOps — 注解 → 与渲染库无关的「绘制描述符」（纯逻辑，可单测）
//   坐标从归一化(左上原点) 转为 PDF 点坐标(左下原点)；
//   适配器再把描述符喂给 pdf-lib 真正绘制（见 exportPdf.ts）。
// ============================================================================

export interface RGB {
  r: number
  g: number
  b: number
}
export interface Size {
  width: number
  height: number
}

export type DrawOp =
  | { page: number; kind: 'rect'; x: number; y: number; w: number; h: number; color: RGB; fill: boolean; stroke: boolean; opacity: number }
  | { page: number; kind: 'polyline'; points: Array<{ x: number; y: number }>; color: RGB; width: number }
  | { page: number; kind: 'text'; x: number; y: number; text: string; color: RGB; size: number }

export function parseColor(hex: string): RGB {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const n = parseInt(full, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

const BLACK: RGB = { r: 0, g: 0, b: 0 }

export function buildDrawOps(annotations: Annotation[], pageSizes: Size[]): DrawOp[] {
  const ops: DrawOp[] = []
  for (const a of annotations) {
    const page = a.type === 'ink' ? a.page : a.rect.page
    const size = pageSizes[page]
    if (!size) continue // 越界页跳过
    const { width: W, height: H } = size

    if (a.type === 'highlight' || a.type === 'rect' || a.type === 'redact') {
      const r = a.rect
      const op: DrawOp = {
        page,
        kind: 'rect',
        x: r.x * W,
        y: (1 - r.y - r.h) * H, // y 翻转到左下原点
        w: r.w * W,
        h: r.h * H,
        color: a.type === 'redact' ? BLACK : parseColor(a.color),
        fill: a.type !== 'rect',
        stroke: a.type === 'rect',
        opacity: a.type === 'highlight' ? 0.35 : 1,
      }
      ops.push(op)
    } else if (a.type === 'ink') {
      ops.push({
        page,
        kind: 'polyline',
        points: a.points.map((p) => ({ x: p.x * W, y: (1 - p.y) * H })),
        color: parseColor(a.color),
        width: a.width,
      })
    } else if (a.type === 'note') {
      const r = a.rect
      ops.push({
        page,
        kind: 'text',
        x: r.x * W,
        y: (1 - r.y - r.h) * H,
        text: a.text,
        color: { r: 0.1, g: 0.1, b: 0.1 },
        size: 12,
      })
    }
  }
  return ops
}
