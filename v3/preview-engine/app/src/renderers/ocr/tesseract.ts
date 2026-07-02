import type { OcrWord } from './layout'

// ============================================================================
// tesseract — 运行时从 CDN 动态加载 Tesseract.js 做 OCR（按需，不进主包）
//   返回词级别 bbox，供图片文本层叠加（可选/可复制/可翻译）。
// ============================================================================

let _mod: Promise<unknown> | null = null
function loadTesseract(): Promise<unknown> {
  if (!_mod) {
    // @ts-ignore 运行时远程 ESM
    _mod = import(/* @vite-ignore */ 'https://esm.sh/tesseract.js@5')
  }
  return _mod
}

export async function recognizeImage(
  blob: Blob,
  lang = 'chi_sim+eng',
  onProgress?: (p: number) => void,
): Promise<OcrWord[]> {
  const mod = (await loadTesseract()) as { default?: unknown; recognize?: unknown }
  const Tesseract = (mod.default ?? mod) as {
    recognize: (
      img: string,
      lang: string,
      opts: { logger?: (m: { status: string; progress: number }) => void },
    ) => Promise<{ data: { words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> } }>
  }
  const url = URL.createObjectURL(blob)
  try {
    const { data } = await Tesseract.recognize(url, lang, {
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress?.(m.progress)
      },
    })
    return (data.words ?? [])
      .filter((w) => w.text && w.text.trim())
      .map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }))
  } finally {
    URL.revokeObjectURL(url)
  }
}
