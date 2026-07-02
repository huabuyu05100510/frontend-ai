/**
 * 文本宽度测量
 *
 * 使用 OffscreenCanvas 测量，Worker 线程安全。
 *
 * @module utils/measure
 */

/** 全局共享的测量 Canvas */
let _measureCanvas: OffscreenCanvas | null = null;
let _measureCtx: OffscreenCanvasRenderingContext2D | null = null;

function getMeasureContext(): OffscreenCanvasRenderingContext2D | null {
  if (!_measureCtx) {
    try {
      _measureCanvas = new OffscreenCanvas(1, 1);
      _measureCtx = _measureCanvas.getContext('2d');
    } catch {
      // OffscreenCanvas 不可用时返回 null
      return null;
    }
  }
  return _measureCtx;
}

/**
 * 测量文本宽度
 *
 * @param text 要测量的文本
 * @param fontSize 字号（px）
 * @param fontFamily 字体族，默认 sans-serif
 * @returns 文本渲染宽度（px），测量失败时返回估算值
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily = 'sans-serif',
): number {
  const ctx = getMeasureContext();
  if (!ctx) {
    // fallback: 粗略估算（等宽假设）
    return text.length * fontSize * 0.6;
  }

  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  return metrics.width;
}

/**
 * 计算 TextLayer 中 span 的 scaleX 修正值
 *
 * Canvas 渲染的文本宽度与 DOM 文本宽度存在差异，
 * 该函数计算 scaleX transform 值来修正。
 *
 * @param text 文本内容
 * @param fontSize 字号
 * @param targetWidth Canvas 中的目标宽度（bbox.w * scale）
 * @param fontFamily 字体族
 * @returns scaleX 值
 */
export function calcScaleXCorrection(
  text: string,
  fontSize: number,
  targetWidth: number,
  fontFamily = 'sans-serif',
): number {
  if (targetWidth <= 0 || text.length === 0) return 1;

  const domWidth = measureTextWidth(text, fontSize, fontFamily);
  if (domWidth <= 0) return 1;

  return targetWidth / domWidth;
}