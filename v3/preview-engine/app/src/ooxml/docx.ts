import { parseXml, findAll, firstChild, attr, firstText, type XmlNode } from './xml'
import { ZipArchive } from './zip'

// ============================================================================
// docx — WordprocessingML(document.xml) → 结构化 Block[]（纯逻辑，可测）
//   支持：标题/段落/有序无序列表、加粗/斜体/字号/颜色/下划线/删除线、
//         表格、段落对齐/间距/缩进、内嵌图片(w:drawing/a:blip)。
// ============================================================================

export type Align = 'left' | 'center' | 'right' | 'justify'

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  fontSize?: number      // pt（w:sz / 2，w:szCs / 2，CJK 优先）
  color?: string         // '#RRGGBB'（w:color val）
  underline?: boolean    // w:u val !== 'none'
  strikethrough?: boolean // w:strike / w:dstrike
}

/** 段落样式属性（来自 styles.xml） */
export interface DocxStyle {
  styleId: string
  name: string
  basedOn?: string
  fontSize?: number       // pt, w:sz/2
  fontSizeCs?: number     // pt CJK, w:szCs/2
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  lineSpacing?: number    // 倍数, w:line/240（auto rule 下）
  spacingBefore?: number
  spacingAfter?: number
  indentLeft?: number     // px
  indentFirstLine?: number // px
  isDefault?: boolean
}

/** styles.xml 解析结果：styleId → 解析后的样式（含 docDefaults 合并） */
export type StyleMap = Record<string, DocxStyle>

export type Block =
  | { type: 'heading'; level: number; runs: Run[]; align?: Align }
  | {
      type: 'paragraph'
      runs: Run[]
      align?: Align
      spacingBefore?: number
      spacingAfter?: number
      indentLeft?: number
      indentFirstLine?: number // px（w:firstLine / w:hanging 转 px）
      lineHeight?: number // 倍数（w:line / 240）
    }
  | { type: 'list'; ordered: boolean; level: number; runs: Run[]; align?: Align; numId?: string }
  | { type: 'table'; rows: Run[][][] }
  | { type: 'image'; rId?: string; target?: string; src?: string; width?: number; height?: number; align?: Align }

const FALSY = new Set(['0', 'false', 'off'])
const EMU_PER_PX = 9525
const TWIPS_TO_PX = (1 / 20) * (96 / 72) // 1 twip = 1/20 pt, 96dpi

function toggleOn(rPr: XmlNode | undefined, tag: string): boolean {
  if (!rPr) return false
  const el = firstChild(rPr, tag)
  if (!el) return false
  const v = attr(el, 'w:val')
  return v === undefined || !FALSY.has(v)
}

function runOf(r: XmlNode, styleMap?: StyleMap): Run {
  const text = findAll(r, 'w:t')
    .map(firstText)
    .join('')
  const rPr = firstChild(r, 'w:rPr')
  const run: Run = { text }
  if (toggleOn(rPr, 'w:b')) run.bold = true
  if (toggleOn(rPr, 'w:i')) run.italic = true

  // 字号：CJK 优先 w:szCs，否则 w:sz（都是 / 2 → pt）
  const szEl = rPr && firstChild(rPr, 'w:sz')
  const szCsEl = rPr && firstChild(rPr, 'w:szCs')
  const szVal = szEl && attr(szEl, 'w:val')
  const szCsVal = szCsEl && attr(szCsEl, 'w:val')
  const szNum = szCsVal ? parseInt(szCsVal, 10) : szVal ? parseInt(szVal, 10) : 0
  if (szNum > 0) run.fontSize = szNum / 2

  // 颜色：w:color val（auto 忽略）
  const colorEl = rPr && firstChild(rPr, 'w:color')
  const colorVal = colorEl && attr(colorEl, 'w:val')
  if (colorVal && colorVal !== 'auto') run.color = '#' + colorVal

  // 下划线：w:u val 存在且不为 none
  const uEl = rPr && firstChild(rPr, 'w:u')
  const uVal = uEl ? (attr(uEl, 'w:val') ?? 'single') : null
  if (uVal && uVal !== 'none') run.underline = true

  // 删除线：w:strike 或 w:dstrike
  if (toggleOn(rPr, 'w:strike') || toggleOn(rPr, 'w:dstrike')) run.strikethrough = true

  // 兜底：从 pStyle/rStyle 引用 styles.xml 找默认
  if (styleMap) {
    const rStyle = rPr && firstChild(rPr, 'w:rStyle')
    const refId = rStyle ? attr(rStyle, 'w:val') : null
    const ref = refId ? styleMap[refId] : undefined
    if (run.fontSize === undefined && ref?.fontSizeCs) run.fontSize = ref.fontSizeCs
    if (run.fontSize === undefined && ref?.fontSize) run.fontSize = ref.fontSize
    if (run.bold === undefined && ref?.bold) run.bold = true
    if (run.italic === undefined && ref?.italic) run.italic = true
    if (!run.color && ref?.color) run.color = ref.color
    if (run.underline === undefined && ref?.underline) run.underline = true
  }

  return run
}

function runsOf(node: XmlNode, styleMap?: StyleMap): Run[] {
  return findAll(node, 'w:r')
    .map((r) => runOf(r, styleMap))
    .filter((r) => r.text.length > 0)
}

function headingLevel(p: XmlNode): number {
  const pPr = firstChild(p, 'w:pPr')
  const pStyle = pPr && firstChild(pPr, 'w:pStyle')
  const val = pStyle && attr(pStyle, 'w:val')
  if (!val) return 0
  if (/^title$/i.test(val)) return 1
  const m = /heading\s*(\d+)/i.exec(val) || /^(\d+)$/.exec(val)
  return m ? Math.min(6, parseInt(m[1], 10)) : 0
}

/** 段落对齐 w:jc（both/distribute → justify） */
function alignOf(p: XmlNode): Align | undefined {
  const pPr = firstChild(p, 'w:pPr')
  const jc = pPr && firstChild(pPr, 'w:jc')
  const v = jc && attr(jc, 'w:val')
  if (!v) return undefined
  if (v === 'both' || v === 'distribute') return 'justify'
  if (v === 'left' || v === 'center' || v === 'right') return v
  return undefined
}

/** 列表属性 w:numPr */
function numPrOf(p: XmlNode): { numId: string; ilvl: number } | null {
  const pPr = firstChild(p, 'w:pPr')
  if (!pPr) return null
  const numPr = firstChild(pPr, 'w:numPr')
  if (!numPr) return null
  const numIdEl = firstChild(numPr, 'w:numId')
  const ilvlEl = firstChild(numPr, 'w:ilvl')
  const numId = numIdEl ? (attr(numIdEl, 'w:val') ?? null) : null
  const ilvl = ilvlEl ? parseInt(attr(ilvlEl, 'w:val') ?? '0', 10) : 0
  if (!numId || numId === '0') return null
  return { numId, ilvl }
}

/** 段落间距 w:spacing（单位 twips → px；行距 → 倍数） */
function spacingOf(p: XmlNode): {
  spacingBefore?: number
  spacingAfter?: number
  lineHeight?: number
} {
  const pPr = firstChild(p, 'w:pPr')
  const spacing = pPr && firstChild(pPr, 'w:spacing')
  if (!spacing) return {}
  const before = attr(spacing, 'w:before')
  const after = attr(spacing, 'w:after')
  const line = attr(spacing, 'w:line')
  const result: { spacingBefore?: number; spacingAfter?: number; lineHeight?: number } = {}
  if (before) result.spacingBefore = Math.round(parseInt(before, 10) * TWIPS_TO_PX)
  if (after) result.spacingAfter = Math.round(parseInt(after, 10) * TWIPS_TO_PX)
  if (line) {
    const n = parseInt(line, 10)
    if (n > 0) result.lineHeight = n / 240 // 倍数（auto / atLeast / exact 均按 240=单倍近似）
  }
  return result
}

/** 段落缩进 w:ind（单位 twips → px；firstLine/hanging 也转换） */
function indentOf(p: XmlNode): { indentLeft?: number; indentFirstLine?: number } {
  const pPr = firstChild(p, 'w:pPr')
  const ind = pPr && firstChild(pPr, 'w:ind')
  if (!ind) return {}
  const left = attr(ind, 'w:left')
  const first = attr(ind, 'w:firstLine')
  const hanging = attr(ind, 'w:hanging')
  const result: { indentLeft?: number; indentFirstLine?: number } = {}
  if (left) result.indentLeft = Math.round(parseInt(left, 10) * TWIPS_TO_PX)
  // 首行缩进正方向；hanging 反方向
  if (first) {
    result.indentFirstLine = Math.round(parseInt(first, 10) * TWIPS_TO_PX)
  } else if (hanging) {
    result.indentFirstLine = Math.round(parseInt(hanging, 10) * TWIPS_TO_PX)
  }
  return result
}

interface ImgRef {
  rId?: string
  width?: number
  height?: number
}

/** 段落内的所有图片引用（w:drawing → a:blip + 尺寸 wp:extent/a:ext） */
function drawingImages(p: XmlNode): ImgRef[] {
  const imgs: ImgRef[] = []
  for (const d of findAll(p, 'w:drawing')) {
    const blip = findAll(d, 'a:blip')[0]
    if (!blip) continue
    const rId = attr(blip, 'r:embed') ?? attr(blip, 'r:link')
    const ext = findAll(d, 'wp:extent')[0] ?? findAll(d, 'a:ext')[0]
    const cx = ext ? parseInt(attr(ext, 'cx') ?? '0', 10) : 0
    const cy = ext ? parseInt(attr(ext, 'cy') ?? '0', 10) : 0
    imgs.push({
      rId,
      width: cx ? Math.round(cx / EMU_PER_PX) : undefined,
      height: cy ? Math.round(cy / EMU_PER_PX) : undefined,
    })
  }
  return imgs
}

/** 一个 w:p → 一个或多个 Block（文本块 + 图片块） */
function paragraphBlocks(p: XmlNode, numMap?: Record<string, boolean>, styleMap?: StyleMap): Block[] {
  const imgs = drawingImages(p)
  const runs = runsOf(p, styleMap)
  const level = headingLevel(p)
  const align = alignOf(p)
  // 取段落样式引用（用于合并 styleMap 默认）
  const pPr = firstChild(p, 'w:pPr')
  const pStyleEl = pPr && firstChild(pPr, 'w:pStyle')
  const pStyleId = pStyleEl ? attr(pStyleEl, 'w:val') : null
  const refStyle = pStyleId && styleMap ? styleMap[pStyleId] : undefined
  const out: Block[] = []
  if (runs.length > 0 || imgs.length === 0) {
    if (level > 0) {
      out.push({ type: 'heading', level, runs, align })
    } else {
      const numPr = numPrOf(p)
      if (numPr && numMap) {
        const ordered = numMap[numPr.numId] ?? false
        out.push({ type: 'list', ordered, level: numPr.ilvl, runs, align, numId: numPr.numId })
      } else {
        const spacing = spacingOf(p)
        const indent = indentOf(p)
        const paraBlock: {
          type: 'paragraph'
          runs: Run[]
          align?: Align
          spacingBefore?: number
          spacingAfter?: number
          indentLeft?: number
          indentFirstLine?: number
          lineHeight?: number
        } = { type: 'paragraph', runs, align, ...spacing, ...indent }
        // 从 styles.xml 兜底行距
        if (paraBlock.lineHeight === undefined && refStyle?.lineSpacing) {
          paraBlock.lineHeight = refStyle.lineSpacing
        }
        out.push(paraBlock)
      }
    }
  }
  for (const im of imgs) out.push({ type: 'image', rId: im.rId, width: im.width, height: im.height, align })
  return out
}

function tableBlock(tbl: XmlNode): Block {
  const rows: Run[][][] = []
  for (const tr of tbl.children.filter((c) => c.tag === 'w:tr')) {
    const cells: Run[][] = []
    for (const tc of tr.children.filter((c) => c.tag === 'w:tc')) {
      cells.push(runsOf(tc))
    }
    rows.push(cells)
  }
  return { type: 'table', rows }
}

/** document.xml 文本 → Block[]（保持文档顺序） */
export function parseDocx(
  documentXml: string,
  numMap?: Record<string, boolean>,
  styleMap?: StyleMap,
): Block[] {
  const root = parseXml(documentXml)
  const body = findAll(root, 'w:body')[0] ?? root
  const blocks: Block[] = []
  for (const node of body.children) {
    if (node.tag === 'w:p') blocks.push(...paragraphBlocks(node, numMap, styleMap))
    else if (node.tag === 'w:tbl') blocks.push(tableBlock(node))
  }
  return blocks
}

/** 关系表 .rels → { rId: target } */
export function parseRels(relsXml: string): Record<string, string> {
  const root = parseXml(relsXml)
  const map: Record<string, string> = {}
  for (const r of findAll(root, 'Relationship')) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target')
    if (id && target) map[id] = target
  }
  return map
}

/** word/numbering.xml → { numId: ordered（true=有序数字列表） } */
export function parseNumbering(xml: string): Record<string, boolean> {
  const root = parseXml(xml)
  // abstractNumId → ordered
  const absOrdered: Record<string, boolean> = {}
  for (const absNum of findAll(root, 'w:abstractNum')) {
    const absId = attr(absNum, 'w:abstractNumId')
    if (!absId) continue
    const lvl = findAll(absNum, 'w:lvl')[0]
    const numFmt = lvl && firstChild(lvl, 'w:numFmt')
    const val = numFmt && attr(numFmt, 'w:val')
    absOrdered[absId] =
      val === 'decimal' ||
      val === 'upperLetter' ||
      val === 'lowerLetter' ||
      val === 'upperRoman' ||
      val === 'lowerRoman'
  }
  // numId → abstractNumId → ordered
  const result: Record<string, boolean> = {}
  for (const num of findAll(root, 'w:num')) {
    const numId = attr(num, 'w:numId')
    const absRef = firstChild(num, 'w:abstractNumId')
    const absId = absRef ? (attr(absRef, 'w:val') ?? null) : null
    if (numId && absId != null) result[numId] = absOrdered[absId] ?? false
  }
  return result
}

/** 解析相对路径（处理 ../），base 为目录 */
function joinPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = baseDir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tiff: 'image/tiff',
}

// ============================================================================
// styles.xml → StyleMap
//   解析 <w:style> + <w:docDefaults>，合并 docDefaults 到未显式指定的字段。
//   暂不递归 basedOn（保留 basedOn 字段供上层按需解析）。
// ============================================================================

/** 把 rPrXml 节点提取为 DocxStyle 的 run 字段；不修改入参 */
function styleFromRPr(rPrXml: XmlNode | undefined): Partial<DocxStyle> {
  if (!rPrXml) return {}
  const out: Partial<DocxStyle> = {}
  const szEl = firstChild(rPrXml, 'w:sz')
  const szCsEl = firstChild(rPrXml, 'w:szCs')
  const szVal = szEl ? attr(szEl, 'w:val') : undefined
  const szCsVal = szCsEl ? attr(szCsEl, 'w:val') : undefined
  if (szVal) {
    const n = parseInt(szVal, 10)
    if (n > 0) out.fontSize = n / 2
  }
  if (szCsVal) {
    const n = parseInt(szCsVal, 10)
    if (n > 0) out.fontSizeCs = n / 2
  }
  if (toggleOn(rPrXml, 'w:b')) out.bold = true
  if (toggleOn(rPrXml, 'w:i')) out.italic = true
  const uEl = firstChild(rPrXml, 'w:u')
  const uVal = uEl ? (attr(uEl, 'w:val') ?? 'single') : null
  if (uVal && uVal !== 'none') out.underline = true
  const colorEl = firstChild(rPrXml, 'w:color')
  const colorVal = colorEl ? attr(colorEl, 'w:val') : undefined
  if (colorVal && colorVal !== 'auto') out.color = '#' + colorVal
  return out
}

/** 把 pPrXml 节点提取为 spacing/indent/lineHeight */
function styleFromPPr(pPrXml: XmlNode | undefined): Partial<DocxStyle> {
  if (!pPrXml) return {}
  const out: Partial<DocxStyle> = {}
  const spacing = firstChild(pPrXml, 'w:spacing')
  if (spacing) {
    const before = attr(spacing, 'w:before')
    const after = attr(spacing, 'w:after')
    const line = attr(spacing, 'w:line')
    if (before) out.spacingBefore = Math.round(parseInt(before, 10) * TWIPS_TO_PX)
    if (after) out.spacingAfter = Math.round(parseInt(after, 10) * TWIPS_TO_PX)
    if (line) {
      const n = parseInt(line, 10)
      if (n > 0) out.lineSpacing = n / 240
    }
  }
  const ind = firstChild(pPrXml, 'w:ind')
  if (ind) {
    const left = attr(ind, 'w:left')
    const first = attr(ind, 'w:firstLine')
    const hanging = attr(ind, 'w:hanging')
    if (left) out.indentLeft = Math.round(parseInt(left, 10) * TWIPS_TO_PX)
    if (first) out.indentFirstLine = Math.round(parseInt(first, 10) * TWIPS_TO_PX)
    else if (hanging) out.indentFirstLine = Math.round(parseInt(hanging, 10) * TWIPS_TO_PX)
  }
  return out
}

/**
 * styles.xml 文本 → StyleMap（合并 docDefaults）。
 * 异常 XML 不抛，返回 {} 或部分解析。
 */
export function parseStylesXml(xml: string): StyleMap {
  if (!xml || !xml.trim()) return {}
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch {
    return {}
  }
  // docDefaults → 兜底（rPrDefault + pPrDefault）
  const defaults: Partial<DocxStyle> = {}
  const docDefaults = firstChild(root, 'w:docDefaults')
  if (docDefaults) {
    const rPrDef = firstChild(docDefaults, 'w:rPrDefault')
    if (rPrDef) Object.assign(defaults, styleFromRPr(firstChild(rPrDef, 'w:rPr')))
    const pPrDef = firstChild(docDefaults, 'w:pPrDefault')
    if (pPrDef) Object.assign(defaults, styleFromPPr(firstChild(pPrDef, 'w:pPr')))
  }

  const map: StyleMap = {}
  for (const style of findAll(root, 'w:style')) {
    const styleId = attr(style, 'w:styleId')
    if (!styleId) continue
    const nameEl = firstChild(style, 'w:name')
    const name = nameEl ? (attr(nameEl, 'w:val') ?? styleId) : styleId
    const basedOnEl = firstChild(style, 'w:basedOn')
    const basedOn = basedOnEl ? attr(basedOnEl, 'w:val') : undefined
    const isDefault = attr(style, 'w:default') === '1' || attr(style, 'w:default') === 'true'
    const merged: DocxStyle = {
      styleId,
      name,
      basedOn,
      isDefault,
      ...defaults, // 先填 defaults
      ...styleFromRPr(firstChild(style, 'w:rPr')), // 显式覆盖
      ...styleFromPPr(firstChild(style, 'w:pPr')), // 显式覆盖
    }
    map[styleId] = merged
  }
  return map
}

/** 从 DOCX 字节加载 → Block[]（解析图片关系并生成可显示的对象 URL） */
export async function loadDocx(bytes: Uint8Array, stylesXml?: string): Promise<Block[]> {
  const zip = await ZipArchive.open(bytes)
  const xml = await zip.text('word/document.xml')
  const numMap = zip.has('word/numbering.xml')
    ? parseNumbering(await zip.text('word/numbering.xml'))
    : undefined
  const stylesXmlResolved =
    stylesXml ??
    (zip.has('word/styles.xml') ? await zip.text('word/styles.xml') : undefined)
  const styleMap = stylesXmlResolved ? parseStylesXml(stylesXmlResolved) : undefined
  const blocks = parseDocx(xml, numMap, styleMap)
  const rels = zip.has('word/_rels/document.xml.rels')
    ? parseRels(await zip.text('word/_rels/document.xml.rels'))
    : {}
  for (const b of blocks) {
    if (b.type !== 'image' || !b.rId) continue
    const target = rels[b.rId]
    if (!target) continue
    const path = joinPath('word', target)
    if (!zip.has(path)) continue
    b.target = path
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const data = await zip.bytes(path)
    try {
      const blob = new Blob([data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' })
      b.src = URL.createObjectURL(blob)
    } catch {
      // 非浏览器环境（测试）跳过对象 URL
    }
  }
  return blocks
}
