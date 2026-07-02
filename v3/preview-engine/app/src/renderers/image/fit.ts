// ============================================================================
// imageFit — 图片适配视口的缩放计算
// ============================================================================

export interface Size {
  width: number
  height: number
}

/** 等比缩放使图片完整可见；不放大（上限 1，避免小图模糊） */
export function fitScale(img: Size, viewport: Size): number {
  if (img.width <= 0 || img.height <= 0) return 1
  const sx = viewport.width / img.width
  const sy = viewport.height / img.height
  return Math.min(sx, sy, 1)
}

export function clampScale(scale: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, scale))
}
