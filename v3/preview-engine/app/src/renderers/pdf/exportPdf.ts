import { buildDrawOps } from './exportOps'
import type { Annotation } from './AnnotationModel'
import { loadPdfLib } from './pdfjsLoader'

// ============================================================================
// exportPdf — 把注解烧回真实 PDF 字节（pdf-lib），产出可下载的新文件。
//   产物用任意阅读器打开，批注真实存在 → 证明「非破坏性编辑」可落地。
// ============================================================================

/** Helvetica(WinAnsi) 只能编码 Latin-1；非 ASCII（如中文）回退为标记，避免整体导出失败 */
function isWinAnsiSafe(text: string): boolean {
  return /^[\x00-\xFF]*$/.test(text)
}

export async function exportPdf(srcBytes: ArrayBuffer, annotations: Annotation[]): Promise<Blob> {
  let PDFLib: any
  try {
    PDFLib = await loadPdfLib()
  } catch (e) {
    throw new Error('pdf-lib 加载失败（CDN 不可达）：' + String(e))
  }
  const { PDFDocument, rgb } = PDFLib
  const doc = await PDFDocument.load(srcBytes)
  const pages = doc.getPages()
  const pageSizes = pages.map((p: { getSize: () => { width: number; height: number } }) => p.getSize())
  const ops = buildDrawOps(annotations, pageSizes)
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica)

  for (const op of ops) {
    const page = pages[op.page]
    if (!page) continue
    try {
      if (op.kind === 'rect') {
        page.drawRectangle({
          x: op.x,
          y: op.y,
          width: op.w,
          height: op.h,
          color: op.fill ? rgb(op.color.r, op.color.g, op.color.b) : undefined,
          borderColor: op.stroke ? rgb(op.color.r, op.color.g, op.color.b) : undefined,
          borderWidth: op.stroke ? 1.5 : 0,
          opacity: op.fill ? op.opacity : 1,
          borderOpacity: 1,
        })
      } else if (op.kind === 'polyline') {
        for (let i = 1; i < op.points.length; i++) {
          const a = op.points[i - 1]
          const b = op.points[i]
          page.drawLine({
            start: { x: a.x, y: a.y },
            end: { x: b.x, y: b.y },
            thickness: op.width,
            color: rgb(op.color.r, op.color.g, op.color.b),
          })
        }
      } else if (op.kind === 'text') {
        if (isWinAnsiSafe(op.text)) {
          page.drawText(op.text, { x: op.x, y: op.y, size: op.size, font, color: rgb(op.color.r, op.color.g, op.color.b) })
        } else {
          // 非 Latin（如中文）：标准字体无法编码，烧入一个便签标记框占位
          page.drawRectangle({ x: op.x, y: op.y, width: 14, height: 14, color: rgb(1, 0.95, 0.4), opacity: 0.9 })
        }
      }
    } catch {
      // 单个注解绘制失败不应中断整体导出
    }
  }

  const out = await doc.save()
  return new Blob([out as BlobPart], { type: 'application/pdf' })
}
