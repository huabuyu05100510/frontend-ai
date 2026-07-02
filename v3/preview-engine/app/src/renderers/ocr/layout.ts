// ============================================================================
// ocr/layout — OCR 词框 → 屏幕坐标（纯函数，可测）
//   将识别坐标（图片原始像素）按渲染尺寸缩放为叠加层定位，
//   用于在图片上叠加透明可选/可复制文本（类 PDF 文本层）。
// ============================================================================

export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrBox {
  left: number
  top: number
  width: number
  height: number
  text: string
}

export function layoutOcrBoxes(
  words: OcrWord[],
  natural: { w: number; h: number },
  rendered: { w: number; h: number },
): OcrBox[] {
  if (natural.w <= 0 || natural.h <= 0) return []
  const sx = rendered.w / natural.w
  const sy = rendered.h / natural.h
  return words.map((w) => ({
    left: w.x0 * sx,
    top: w.y0 * sy,
    width: (w.x1 - w.x0) * sx,
    height: (w.y1 - w.y0) * sy,
    text: w.text,
  }))
}

/** 词序列 → 可复制纯文本 */
export function ocrText(words: OcrWord[]): string {
  return words
    .map((w) => w.text)
    .filter(Boolean)
    .join(' ')
}
