import { parseXml, findAll, firstChild, attr, firstText } from './xml'
import { ZipArchive } from './zip'

// ============================================================================
// xlsx — SpreadsheetML → SheetModel（纯逻辑，可测）
//   单元格值来源：t="s"→共享字符串，t="inlineStr"→内联，其余→数值/字符串。
//   列宽来源：<col width>（字符宽 × 7px）；行高来源：<row ht>（pt × 4/3）。
// ============================================================================

export const DEFAULT_COL_W = 80  // px（无自定义宽时回退）
export const DEFAULT_ROW_H = 20  // px（无自定义高时回退）

export interface Cell {
  r: number
  c: number
  text: string
}
export interface SheetModel {
  name: string
  rows: number
  cols: number
  cells: Map<string, Cell> // key = "r,c"
  colWidths?: number[]     // 每列 px，不足部分用 DEFAULT_COL_W 填充
  rowHeights?: number[]    // 每行 px，不足部分用 DEFAULT_ROW_H 填充
}

export function colToIndex(col: string): number {
  let n = 0
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64)
  return n - 1
}

/** 列索引 → 字母（0→A, 25→Z, 26→AA），colToIndex 的逆 */
export function indexToCol(index: number): string {
  let s = ''
  let n = index + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function parseA1(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return { r: 0, c: 0 }
  return { r: parseInt(m[2], 10) - 1, c: colToIndex(m[1]) }
}

/** sharedStrings.xml → 字符串表（si 可含多个 run，需拼接） */
export function parseSharedStrings(xml: string): string[] {
  const root = parseXml(xml)
  return findAll(root, 'si').map((si) =>
    findAll(si, 't')
      .map(firstText)
      .join(''),
  )
}

export function parseSheet(name: string, sheetXml: string, shared: string[]): SheetModel {
  const root = parseXml(sheetXml)

  // 解析列宽：<col min max width>，width 单位为字符宽，Excel 约 7px/char
  const colWidths: number[] = []
  for (const col of findAll(root, 'col')) {
    const min = parseInt(attr(col, 'min') ?? '1', 10) - 1 // 转 0-indexed
    const max = parseInt(attr(col, 'max') ?? '1', 10) - 1
    const w = parseFloat(attr(col, 'width') ?? '0')
    if (w > 0) {
      const px = Math.round(w * 7)
      for (let i = min; i <= max; i++) colWidths[i] = px
    }
  }

  // 解析行高：<row r ht>，ht 单位为 pt，96dpi 下 1pt = 4/3 px
  const rowHeights: number[] = []
  for (const row of findAll(root, 'row')) {
    const rNum = parseInt(attr(row, 'r') ?? '0', 10) - 1
    const ht = parseFloat(attr(row, 'ht') ?? '0')
    if (ht > 0 && rNum >= 0) rowHeights[rNum] = Math.round(ht * (4 / 3))
  }

  // 解析单元格（原始逻辑不变）
  const cells = new Map<string, Cell>()
  let maxR = -1
  let maxC = -1
  for (const c of findAll(root, 'c')) {
    const ref = attr(c, 'r')
    if (!ref) continue
    const { r, col } = (() => {
      const p = parseA1(ref)
      return { r: p.r, col: p.c }
    })()
    const t = attr(c, 't')
    let text = ''
    if (t === 's') {
      const v = firstChild(c, 'v')
      const idx = v ? parseInt(firstText(v), 10) : NaN
      text = Number.isFinite(idx) ? (shared[idx] ?? '') : ''
    } else if (t === 'inlineStr') {
      const is = firstChild(c, 'is')
      text = is
        ? findAll(is, 't')
            .map(firstText)
            .join('')
        : ''
    } else {
      const v = firstChild(c, 'v')
      text = v ? firstText(v) : ''
    }
    if (text === '') continue
    cells.set(`${r},${col}`, { r, c: col, text })
    if (r > maxR) maxR = r
    if (col > maxC) maxC = col
  }
  return { name, rows: maxR + 1, cols: maxC + 1, cells, colWidths, rowHeights }
}

/** 从 XLSX 字节加载首个工作表 */
export async function loadXlsx(bytes: Uint8Array): Promise<SheetModel> {
  const zip = await ZipArchive.open(bytes)
  const shared = zip.has('xl/sharedStrings.xml') ? parseSharedStrings(await zip.text('xl/sharedStrings.xml')) : []
  const sheetName =
    zip.names()
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(/sheet(\d+)\.xml$/.exec(a)![1], 10)
        const nb = parseInt(/sheet(\d+)\.xml$/.exec(b)![1], 10)
        return na - nb
      })[0] ?? 'xl/worksheets/sheet1.xml'
  const sheetXml = await zip.text(sheetName)
  return parseSheet('Sheet1', sheetXml, shared)
}
