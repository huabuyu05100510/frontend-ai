// ============================================================================
// anchor — PDF 注解的「坐标无关」锚点变换
//   注解锚点存归一化比例（0~1，页内，原点左上），与缩放/DPR/设备无关。
//   渲染时按当前视口（含旋转）换算到屏幕 px；交互时反向换算回归一化。
// ============================================================================

export type Rotation = 0 | 90 | 180 | 270

export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PdfRect extends NormRect {
  page: number
}

export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Viewport {
  width: number // 当前渲染宽（px，已含 scale 与旋转后尺寸）
  height: number
  scale: number // 仅供调用方参考；锚点变换与 scale 无关（这正是「坐标无关」）
  rotation: Rotation
}

/** 将归一化矩形从页坐标系旋转到显示坐标系（顺时针） */
export function rotateRectNorm(r: NormRect, rotation: Rotation): NormRect {
  switch (rotation) {
    case 0:
      return { x: r.x, y: r.y, w: r.w, h: r.h }
    case 90:
      return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }
    case 180:
      return { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h }
    case 270:
      return { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w }
  }
}

const INVERSE: Record<Rotation, Rotation> = { 0: 0, 90: 270, 180: 180, 270: 90 }

export function toScreen(rect: PdfRect, vp: Viewport): ScreenRect {
  const d = rotateRectNorm(rect, vp.rotation)
  return {
    x: d.x * vp.width,
    y: d.y * vp.height,
    w: d.w * vp.width,
    h: d.h * vp.height,
  }
}

export function toPdf(screen: ScreenRect, vp: Viewport, page: number): PdfRect {
  const displayNorm: NormRect = {
    x: screen.x / vp.width,
    y: screen.y / vp.height,
    w: screen.w / vp.width,
    h: screen.h / vp.height,
  }
  const pageNorm = rotateRectNorm(displayNorm, INVERSE[vp.rotation])
  return { page, ...pageNorm }
}
