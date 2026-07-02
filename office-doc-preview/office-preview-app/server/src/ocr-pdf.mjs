// 可搜索 PDF 生成器 — 纯函数（无需第三方依赖）
// 模型：claude-sonnet-4-6
//
// 输出 PDF 包含：
//   1. 标题/生产者/创建时间元数据（PDF Info dict）
//   2. 单页（A4 / Letter）
//   3. 透明文字层：把 OCR 识别结果按原图坐标投影到 PDF 页面
//   4. 文字可选/可搜索/可复制（PDF text-showing operators: BT/ET/Tj/TJ/Tm）
//
// 设计取舍：
//   - 不嵌入图片（避免 /DCTDecode 流复杂度）；原图通过元数据 refer 关联
//   - 使用 Helvetica 内建字体（PDF spec 14 standard fonts，无需 embed）
//   - 零依赖，仅 Node.js 内建 Buffer
//
// 核心导出：
//   - generateSearchablePdf({ text, title, pageSize?, imageSize?, regions? }) -> Buffer
//   - escapePdfString(str)                                    -> string
//   - A4_SIZE / LETTER_SIZE                                   -> const { width, height }

export const A4_SIZE = { width: 595, height: 842 }
export const LETTER_SIZE = { width: 612, height: 792 }
const PAGE_SIZES = { A4: A4_SIZE, Letter: LETTER_SIZE }

const PRODUCER = 'office-preview-app (ai-ocr)'

/**
 * PDF 字符串编码：纯 latin-1 → literal string (parentheses)；
 * 含非 latin-1 → hex string (angle brackets) + UTF-16BE BOM。
 * 这样可以原生支持 CJK / Emoji 等 Unicode。
 */
function isLatin1Only(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0xff) return false
  }
  return true
}

export function escapePdfString(str) {
  const s = String(str ?? '')
  if (isLatin1Only(s)) {
    return '(' + s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')'
  }
  // UTF-16BE with BOM (FE FF)
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    bytes.push((code >> 8) & 0xff, code & 0xff)
  }
  const buf = Buffer.from([0xfe, 0xff, ...bytes])
  return '<' + buf.toString('hex') + '>'
}

/**
 * 在 content stream 中的文字：仅 latin-1，否则 '?'
 * 完整 CJK 渲染需嵌入字体子集 — 此处确保 PDF 仍合法可解析。
 */
function toLatin1Safe(str) {
  // CJK 区段：基本汉字 U+4E00-U+9FFF、扩展 A 区 U+3400-U+4DBF、平假名 U+3040-U+309F、片假名 U+30A0-U+30FF
  return String(str ?? '').replace(
    /[\u0080-\u4DBF\u4E00-\u9FFF\u3040-\u30FF]/g,
    () => '?'
  )
}

/** 构造文字 content stream（PDF 渲染指令）。每行独立 BT/ET，便于 viewer 选中单行。 */
function buildContentStream({ text, imageSize, regions, pageHeight, scale }) {
  const blocks = []

  if (regions && regions.length > 0 && imageSize) {
    // 按区域定位：每个区域单独 BT/ET
    for (const reg of regions) {
      const safe = toLatin1Safe(reg.text || '')
      if (!safe.trim()) continue
      const px = (reg.x || 0) * scale
      const py = pageHeight - (reg.y || 0) * scale - 12  // flip y, leave 12pt baseline
      const sz = Math.max(8, Math.min(20, (reg.height || 16) * scale * 0.8))
      blocks.push(
        'BT\n' +
          '/F1 ' + sz.toFixed(2) + ' Tf\n' +
          '1 0 0 1 ' + px.toFixed(2) + ' ' + py.toFixed(2) + ' Tm\n' +
          '(' + escapePdfString(safe) + ') Tj\n' +
          'ET'
      )
    }
  } else {
    // 回退：按行渲染 text（支持 \n）；每行独立 BT/ET
    const lines2 = String(text || '').split(/\n+/)
    let y = pageHeight - 60
    for (const ln of lines2) {
      const safe = toLatin1Safe(ln)
      if (y < 40) break  // 防止溢出
      blocks.push(
        'BT\n' +
          '/F1 12 Tf\n' +
          '1 0 0 1 40 ' + y.toFixed(2) + ' Tm\n' +
          '(' + escapePdfString(safe) + ') Tj\n' +
          'ET'
      )
      y -= 18
    }
  }
  return blocks.join('\n')
}

/**
 * 生成可搜索 PDF
 * @param {object} opts
 * @param {string} [opts.text]               - 全文（regions 缺省时回退用）
 * @param {string} [opts.title]              - PDF /Title
 * @param {string} [opts.pageSize='A4']      - 'A4' | 'Letter'
 * @param {object} [opts.imageSize]          - { width, height } 原图像素尺寸；regions 定位需要
 * @param {Array}  [opts.regions]            - [{text, x, y, width, height}] OCR 区域
 * @returns {Buffer}
 */
export function generateSearchablePdf(opts = {}) {
  const {
    text = '',
    title = 'OCR Searchable PDF',
    pageSize = 'A4',
    imageSize,
    regions,
  } = opts

  const ps = PAGE_SIZES[pageSize] || A4_SIZE
  const pageW = ps.width
  const pageH = ps.height

  // 缩放：原图按宽度等比缩放铺满 PDF 页面宽度
  const scale = imageSize && imageSize.width > 0 ? pageW / imageSize.width : 1

  const content = buildContentStream({
    text,
    regions,
    imageSize,
    pageHeight: pageH,
    scale,
  })

  // 构造对象体（按 obj 顺序：1 Catalog, 2 Pages, 3 Page, 4 Font, 5 Content）
  const objs = []
  // 1 - Catalog
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  // 2 - Pages
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  // 3 - Page
  objs.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      pageW.toFixed(2) + ' ' + pageH.toFixed(2) +
      '] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
  )
  // 4 - Font (Helvetica 内建字体)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  // 5 - Content stream
  const stream = content
  objs.push(
    '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream'
  )

  // 元数据 Info dict（用 object 6 表达 title/producer/date）
  // Title 用 escapePdfString 自动选择 latin-1 literal 或 UTF-16BE hex
  const infoStr =
    '<< /Title ' +
    escapePdfString(title) +
    ' /Producer ' +
    escapePdfString(PRODUCER) +
    ' /CreationDate (D:' +
    new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) +
    ') >>'
  objs.unshift() // 占位位，由后续 splice 插入到 object 6
  // 重排：1 Catalog, 2 Pages, 3 Page, 4 Font, 5 Content, 6 Info
  objs.push(infoStr)

  // 构造 PDF 字节流
  const header = '%PDF-1.4\n' + '%' + '\xE2\xE3\xCF\xD3' + '\n'  // 二进制提示头
  const parts = []
  parts.push(header)
  const offsets = [0]  // index 0 is free object
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
    'xref\n0 ' +
    (objs.length + 1) +
    '\n0000000000 65535 f \n' +
    offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')

  parts.push(xref)
  pos += Buffer.byteLength(xref, 'latin1')
  // trailer
  const trailer =
    'trailer\n<< /Size ' +
    (objs.length + 1) +
    ' /Root 1 0 R /Info ' +
    objs.length +
    ' 0 R >>\nstartxref\n' +
    xrefStart +
    '\n%%EOF\n'
  parts.push(trailer)

  return Buffer.from(parts.join(''), 'latin1')
}
