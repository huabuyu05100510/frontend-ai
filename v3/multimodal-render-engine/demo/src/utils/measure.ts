/**
 * 使用 OffscreenCanvas 测量文字宽度（Worker 安全）
 */
const measureCanvas = new OffscreenCanvas(1, 1)
const ctx = measureCanvas.getContext('2d')!

/**
 * 测量指定字体大小下文字的像素宽度
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily = 'sans-serif'
): number {
  ctx.font = `${fontSize}px ${fontFamily}`
  return ctx.measureText(text).width
}
