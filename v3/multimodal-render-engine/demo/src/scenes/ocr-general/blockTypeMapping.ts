import type { BlockType, TextBlock } from '../../core/types'

export type OcrRole = 'title' | 'subtitle' | 'field' | 'body' | 'separator'

export interface OcrBlock {
  role: OcrRole
  label?: string
  text: string
  confidence: number
  bbox: { x: number; y: number; w: number; h: number }  // 归一化 0-1
}

/**
 * OcrBlock role → TextBlock BlockType 映射
 * title/subtitle → heading（差异通过 fontSize 体现，不拆两个类型）
 * field → cell（label + value 结构）
 * body → paragraph
 * separator → separator
 */
export function roleToBlockType(role: OcrRole): BlockType {
  switch (role) {
    case 'title':     return 'heading'
    case 'subtitle':  return 'heading'
    case 'field':     return 'cell'
    case 'body':      return 'paragraph'
    case 'separator': return 'separator'
    default:          return 'paragraph'
  }
}

/**
 * 将 OCR 归一化坐标 block 列表转换为 TextBlock（自然像素坐标）
 * @param blocks  OCR 识别结果（bbox 为归一化 0-1）
 * @param nW      图像自然宽度（像素）
 * @param nH      图像自然高度（像素）
 */
export function ocrBlocksToTextBlocks(blocks: OcrBlock[], nW: number, nH: number): TextBlock[] {
  return blocks.map((b, i) => ({
    id: `ocr-block-${i}`,
    text: b.text,
    type: roleToBlockType(b.role),
    bbox: {
      x: b.bbox.x * nW,
      y: b.bbox.y * nH,
      w: b.bbox.w * nW,
      h: b.bbox.h * nH,
    },
    confidence: b.confidence,
    ...(b.label !== undefined ? { label: b.label } : {}),
  }))
}
