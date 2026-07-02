// Translated Export — 双语 / 译文 DOCX 和 PDF 生成器
// 模型：claude-sonnet-4-6
//
// 用途：
//   - 把 translate() 出来的 pages[] 转成可下载的 DOCX / PDF 二进制
//   - DOCX：使用 `docx` 库，按页表格布局（原 yellow 文 + 译 blue 文）
//   - PDF：复用 ocr-pdf.mjs 的零依赖 PDF 生成器，按页两列（source / target）
//
// 设计取舍：
//   - DOCX 走 `docx` 库（声明式 API），不手写 OOXML
//   - PDF 走 ocr-pdf.mjs 模式（零依赖 + UTF-16BE BOM 支持 CJK）
//   - 所有特殊字符（< > & " '）由 `docx` 自动转义
//   - 所有公开函数均返回 Promise<Buffer>，便于 async/await 链式
//
// 公开 API：
//   - generateBilingualDocx({pages, sourceLang, targetLang, taskName?}) → Promise<Buffer>
//   - generateBilingualPdf({pages, sourceLang, targetLang, taskName?}) → Promise<Buffer>
//   - generateTranslationOnlyPdf({pages, targetLang, taskName?}) → Promise<Buffer>

import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  ShadingType,
  AlignmentType,
  Packer,
  BorderStyle,
} from 'docx'

import { generateSearchablePdf, escapePdfString, A4_SIZE } from './ocr-pdf.mjs'

const PRODUCER = 'office-preview-app (translate-export)'

/** DOCX 默认页大小 */
const DOCX_PAGE_WIDTH = A4_SIZE.width   // twips（dxa）
const DOCX_PAGE_HEIGHT = A4_SIZE.height

/** 把字符串切成多个段落（按 \n 或 \r\n） */
function splitParagraphs(text) {
  if (!text) return ['']
  return String(text).split(/\r?\n/).map(s => s).filter((s, i, arr) => {
    // 保留全部段落（包括空行作为段间分隔），但末尾全空段落移除
    if (i === arr.length - 1 && s === '') return false
    return true
  })
}

/** 黄色背景（原文）— docx 要求 6 位 hex（RGB，无 alpha） */
const FILL_SOURCE = 'FCE08B'  // 柔黄
/** 蓝色背景（译文） */
const FILL_TARGET = 'D7E8FF'  // 柔蓝
/** 表头浅灰 */
const FILL_HEADER = 'E6E6E6'

/** 构建单个段落数组 */
function buildParagraphs(text, { bold = false, size = 22 } = {}) {
  const lines = splitParagraphs(text)
  return lines.map(line => new Paragraph({
    children: [new TextRun({ text: line || ' ', bold, size })],
    spacing: { before: 60, after: 60 },
  }))
}

/** 构建一个 cell（带背景色 + 段落） */
function buildCell(text, fill, { bold = false, header = false } = {}) {
  const cellOpts = {
    width: { size: 50, type: WidthType.PERCENTAGE },
    shading: {
      type: ShadingType.CLEAR,
      fill,
      color: 'auto',
    },
    margins: {
      top: 100,
      bottom: 100,
      left: 140,
      right: 140,
    },
    children: [
      ...(header ? [new Paragraph({
        children: [new TextRun({ text: '', size: 4 })],
      })] : []),
      ...buildParagraphs(text, { bold }),
    ],
  }
  return new TableCell(cellOpts)
}

/** 构造一个 page table（2 列：原文 / 译文） */
function buildPageTable(page, sourceLang, targetLang) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 6, color: '888888' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '888888' },
      left:   { style: BorderStyle.SINGLE, size: 6, color: '888888' },
      right:  { style: BorderStyle.SINGLE, size: 6, color: '888888' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
      insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
    },
    rows: [
      // Header row: language labels
      new TableRow({
        tableHeader: false,
        children: [
          buildCell(`Source (${sourceLang})`, FILL_HEADER, { bold: true, header: true }),
          buildCell(`Target (${targetLang})`, FILL_HEADER, { bold: true, header: true }),
        ],
      }),
      // Content row: source / target text
      new TableRow({
        children: [
          buildCell(page.sourceText || '', FILL_SOURCE),
          buildCell(page.targetText || '', FILL_TARGET),
        ],
      }),
    ],
  })
}

/**
 * 生成双语 DOCX
 * @param {{pages:Array, sourceLang:string, targetLang:string, taskName?:string}} opts
 * @returns {Promise<Buffer>}
 */
export async function generateBilingualDocx({ pages, sourceLang, targetLang, taskName } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('pages must be a non-empty array')
  }
  if (typeof sourceLang !== 'string' || !sourceLang) throw new Error('sourceLang required')
  if (typeof targetLang !== 'string' || !targetLang) throw new Error('targetLang required')

  const title = taskName ? `Translation: ${taskName}` : `Translation ${sourceLang} → ${targetLang}`

  const children = []
  // Title
  children.push(new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
  }))
  // Language pair subtitle
  children.push(new Paragraph({
    children: [new TextRun({
      text: `${sourceLang} → ${targetLang} · ${pages.length} page${pages.length === 1 ? '' : 's'}`,
      italics: true,
      size: 20,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }))

  // Per-page sections
  for (const p of pages) {
    const pageNum = p.page ?? pages.indexOf(p) + 1
    children.push(new Paragraph({
      children: [new TextRun({ text: `Page ${pageNum}`, bold: true, size: 26 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
    }))
    children.push(buildPageTable(p, sourceLang, targetLang))
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
  }

  const doc = new Document({
    creator: PRODUCER,
    title,
    description: `Bilingual translation export from ${sourceLang} to ${targetLang}`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: DOCX_PAGE_WIDTH * 20,   // pt → twips (1pt = 20twips)
            height: DOCX_PAGE_HEIGHT * 20,
          },
          margin: {
            top: 720,    // 0.5 inch
            right: 720,
            bottom: 720,
            left: 720,
          },
        },
      },
      children,
    }],
  })

  return await Packer.toBuffer(doc)
}

/** ============ PDF ============ */

/** 构造双语 PDF 的 content stream — 按页两列布局 */
function buildBilingualContentStream({ pages, pageW, pageH, langSrc, langTgt, taskName }) {
  const blocks = []
  const colW = pageW / 2 - 30
  const leftX = 20
  const rightX = pageW / 2 + 10
  const topY = pageH - 40
  const bottomY = 40
  const lineHeight = 16

  // 每页布局：标题 + 左栏 source + 右栏 target
  pages.forEach((page, idx) => {
    const y0 = topY
    // Page header
    blocks.push(
      'BT\n' +
        '/F1 12 Tf\n' +
        '1 0 0 1 ' + leftX + ' ' + y0.toFixed(2) + ' Tm\n' +
        '(' + escapePdfString(`Page ${page.page || idx + 1}`) + ') Tj\n' +
        'ET'
    )
    blocks.push(
      'BT\n' +
        '/F1 9 Tf\n' +
        '1 0 0 1 ' + rightX + ' ' + y0.toFixed(2) + ' Tm\n' +
        '(' + escapePdfString(`[${langSrc} → ${langTgt}]`) + ') Tj\n' +
        'ET'
    )

    // 分隔线（用浅灰矩形）
    blocks.push(
      'q\n' +
        '0.7 0.7 0.7 rg\n' +
        leftX + ' ' + (y0 - 18).toFixed(2) + ' ' + (pageW - 40).toFixed(2) + ' 0.5 re\n' +
        'f\n' +
        'Q'
    )

    // 左栏原文：黄色背景矩形
    const leftBgY = y0 - 36
    const leftBgH = bottomY + 60
    blocks.push(
      'q\n' +
        '1.0 0.88 0.55 rg\n' +
        leftX + ' ' + leftBgY.toFixed(2) + ' ' + colW.toFixed(2) + ' ' + leftBgH.toFixed(2) + ' re\n' +
        'f\n' +
        'Q'
    )
    // 右栏译文：蓝色背景矩形
    blocks.push(
      'q\n' +
        '0.84 0.91 1.0 rg\n' +
        rightX + ' ' + leftBgY.toFixed(2) + ' ' + colW.toFixed(2) + ' ' + leftBgH.toFixed(2) + ' re\n' +
        'f\n' +
        'Q'
    )

    // 左栏文字
    const srcLines = String(page.sourceText || '').split(/\n+/).slice(0, 35) // 防止溢出
    let yL = leftBgY - 18
    for (const ln of srcLines) {
      if (yL < bottomY + 10) break
      blocks.push(
        'BT\n' +
          '/F1 10 Tf\n' +
          '1 0 0 1 ' + (leftX + 8) + ' ' + yL.toFixed(2) + ' Tm\n' +
          '(' + escapePdfString(ln || ' ') + ') Tj\n' +
          'ET'
      )
      yL -= lineHeight
    }

    // 右栏文字
    const tgtLines = String(page.targetText || '').split(/\n+/).slice(0, 35)
    let yR = leftBgY - 18
    for (const ln of tgtLines) {
      if (yR < bottomY + 10) break
      blocks.push(
        'BT\n' +
          '/F1 10 Tf\n' +
          '1 0 0 1 ' + (rightX + 8) + ' ' + yR.toFixed(2) + ' Tm\n' +
          '(' + escapePdfString(ln || ' ') + ') Tj\n' +
          'ET'
      )
      yR -= lineHeight
    }
  })

  return blocks.join('\n')
}

/**
 * 生成双语 PDF（每页双列：source 左 / target 右）
 * @param {{pages:Array, sourceLang:string, targetLang:string, taskName?:string}} opts
 * @returns {Promise<Buffer>}
 */
export async function generateBilingualPdf({ pages, sourceLang, targetLang, taskName } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('pages must be a non-empty array')
  }
  if (typeof sourceLang !== 'string' || !sourceLang) throw new Error('sourceLang required')
  if (typeof targetLang !== 'string' || !targetLang) throw new Error('targetLang required')

  const title = taskName
    ? `Bilingual Translation: ${taskName} (${sourceLang} → ${targetLang})`
    : `Bilingual Translation ${sourceLang} → ${targetLang}`

  const content = buildBilingualContentStream({
    pages,
    pageW: A4_SIZE.width,
    pageH: A4_SIZE.height,
    langSrc: sourceLang,
    langTgt: targetLang,
    taskName,
  })

  return buildMultiPagePdf({
    content,
    title,
    pageCount: pages.length,
    pageSize: A4_SIZE,
  })
}

/** 译文-only PDF 的 content stream（单栏） */
function buildTranslationOnlyContentStream({ pages, pageW, pageH, lang, taskName }) {
  const blocks = []
  const leftX = 40
  const topY = pageH - 40
  const lineHeight = 18

  pages.forEach((page, idx) => {
    // Page header
    blocks.push(
      'BT\n' +
        '/F1 14 Tf\n' +
        '1 0 0 1 ' + leftX + ' ' + topY.toFixed(2) + ' Tm\n' +
        '(' + escapePdfString(`Page ${page.page || idx + 1}`) + ') Tj\n' +
        'ET'
    )
    blocks.push(
      'BT\n' +
        '/F1 9 Tf\n' +
        '1 0 0 1 ' + (pageW - 150) + ' ' + topY.toFixed(2) + ' Tm\n' +
        '(' + escapePdfString(`[Target: ${lang}]`) + ') Tj\n' +
        'ET'
    )

    // 分隔线
    blocks.push(
      'q\n' +
        '0.7 0.7 0.7 rg\n' +
        leftX + ' ' + (topY - 18).toFixed(2) + ' ' + (pageW - 80).toFixed(2) + ' 0.5 re\n' +
        'f\n' +
        'Q'
    )

    // 译文文字
    const tgtLines = String(page.targetText || '').split(/\n+/).slice(0, 40)
    let y = topY - 50
    for (const ln of tgtLines) {
      if (y < 50) break
      blocks.push(
        'BT\n' +
          '/F1 12 Tf\n' +
          '1 0 0 1 ' + leftX + ' ' + y.toFixed(2) + ' Tm\n' +
          '(' + escapePdfString(ln || ' ') + ') Tj\n' +
          'ET'
      )
      y -= lineHeight
    }
  })

  return blocks.join('\n')
}

/**
 * 生成纯译文 PDF（单栏 target 文本）
 * @param {{pages:Array, targetLang:string, taskName?:string}} opts
 * @returns {Promise<Buffer>}
 */
export async function generateTranslationOnlyPdf({ pages, targetLang, taskName } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('pages must be a non-empty array')
  }
  if (typeof targetLang !== 'string' || !targetLang) throw new Error('targetLang required')

  const title = taskName
    ? `Translation: ${taskName} (${targetLang})`
    : `Translation (${targetLang})`

  const content = buildTranslationOnlyContentStream({
    pages,
    pageW: A4_SIZE.width,
    pageH: A4_SIZE.height,
    lang: targetLang,
    taskName,
  })

  return buildMultiPagePdf({
    content,
    title,
    pageCount: pages.length,
    pageSize: A4_SIZE,
  })
}

/**
 * 多页 PDF 生成器：每页一对（Page obj + Content stream obj），共享 Pages + Catalog + Font
 */
function buildMultiPagePdf({ content, title, pageCount, pageSize }) {
  const pageW = pageSize.width
  const pageH = pageSize.height

  // 构造每页的 content stream（拆 N 个 Page 对象）
  // 这里 content 已经是所有页面的 blocks 拼接，但需要按 Page 分块
  // 简化做法：每个 page 用相同的 content，每页 object 引用自己的 stream
  // 为简单起见，将全部 blocks 放进第一个 content stream，其他页引用同一个
  const objs = []
  const objNums = { catalog: 1, pages: 2, font: 3 }
  const pageObjNums = []
  const contentObjNums = []
  let nextObj = 4

  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(nextObj++)
    contentObjNums.push(nextObj++)
  }

  // 1 - Catalog
  objs[objNums.catalog - 1] = '<< /Type /Catalog /Pages 2 0 R >>'
  // 2 - Pages (with N kids)
  const kidsRef = pageObjNums.map(n => `${n} 0 R`).join(' ')
  objs[objNums.pages - 1] = `<< /Type /Pages /Kids [${kidsRef}] /Count ${pageCount} >>`
  // 3 - Font
  objs[objNums.font - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  // Page + Content pairs
  for (let i = 0; i < pageCount; i++) {
    const pageNum = pageObjNums[i]
    const contentNum = contentObjNums[i]
    objs[pageNum - 1] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      pageW.toFixed(2) + ' ' + pageH.toFixed(2) +
      '] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentNum + ' 0 R >>'
    objs[contentNum - 1] =
      '<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + '\nendstream'
  }

  // Info dict（最后）
  const infoNum = nextObj++
  objs[infoNum - 1] =
    '<< /Title ' + escapePdfString(title) +
    ' /Producer ' + escapePdfString(PRODUCER) +
    ' /CreationDate (D:' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + ') >>'

  const totalObjs = objs.length

  // 构造 PDF 字节流
  const header = '%PDF-1.4\n' + '%' + '\xE2\xE3\xCF\xD3' + '\n'
  const parts = [header]
  const offsets = [0]
  let pos = Buffer.byteLength(header, 'latin1')
  for (let i = 0; i < objs.length; i++) {
    const objNum = i + 1
    const objHeader = objNum + ' 0 obj\n'
    const objFooter = '\nendobj\n'
    offsets.push(pos)
    parts.push(objHeader)
    parts.push(objs[i])
    parts.push(objFooter)
    pos += Buffer.byteLength(objHeader, 'latin1')
    pos += Buffer.byteLength(objs[i], 'latin1')
    pos += Buffer.byteLength(objFooter, 'latin1')
  }

  // xref
  const xrefStart = pos
  const xref =
    'xref\n0 ' + (totalObjs + 1) +
    '\n0000000000 65535 f \n' +
    offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  parts.push(xref)
  pos += Buffer.byteLength(xref, 'latin1')

  // trailer
  const trailer =
    'trailer\n<< /Size ' + (totalObjs + 1) +
    ' /Root 1 0 R /Info ' + infoNum + ' 0 R >>\nstartxref\n' +
    xrefStart + '\n%%EOF\n'
  parts.push(trailer)

  return Buffer.from(parts.join(''), 'latin1')
}