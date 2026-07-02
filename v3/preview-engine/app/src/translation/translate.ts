import type { Block } from '../ooxml/docx'
import type { SheetModel } from '../ooxml/xlsx'
import type { Slide } from '../ooxml/pptx'

// ============================================================================
// translation — 结构 → 可译单元 → 译文回填（双语模型）
//   抽取与回填均为纯函数；mockTranslate 为可替换的演示翻译引擎。
// ============================================================================

export interface TransUnit {
  id: string
  text: string
}
export interface Bilingual {
  id: string
  source: string
  target: string
}

function blockText(b: Block): string {
  if (b.type === 'table') return b.rows.flat(2).map((r) => r.text).join(' ')
  if (b.type === 'image') return ''
  return b.runs.map((r) => r.text).join('')
}

export function extractDocxUnits(blocks: Block[]): TransUnit[] {
  const units: TransUnit[] = []
  blocks.forEach((b, i) => {
    const text = blockText(b)
    if (text.trim()) units.push({ id: `b${i}`, text })
  })
  return units
}

export function extractSheetUnits(model: SheetModel): TransUnit[] {
  const units: TransUnit[] = []
  for (const cell of model.cells.values()) {
    if (cell.text.trim()) units.push({ id: `${cell.r},${cell.c}`, text: cell.text })
  }
  return units
}

export function extractSlideUnits(slides: Slide[]): TransUnit[] {
  const units: TransUnit[] = []
  for (const s of slides) {
    s.texts.forEach((t, i) => {
      if (t.text.trim()) units.push({ id: `s${s.index}.t${i}`, text: t.text })
    })
  }
  return units
}

export function applyTranslations(units: TransUnit[], translations: Record<string, string>): Bilingual[] {
  return units.map((u) => ({ id: u.id, source: u.text, target: translations[u.id] ?? u.text }))
}

// 演示词典（真实接入时替换为机器翻译 API）
const DICT: Record<string, string> = {
  苹果: 'Apple',
  香蕉: 'Banana',
  橙子: 'Orange',
  标题: 'Title',
  正文: 'Body',
  章节: 'Chapter',
  名称: 'Name',
  数量: 'Quantity',
  单价: 'Price',
  合计: 'Total',
  你好: 'Hello',
  世界: 'World',
  第一行: 'Line 1',
  第二行: 'Line 2',
}

export function mockTranslate(text: string): string {
  let out = text
  for (const [k, v] of Object.entries(DICT)) {
    if (out.includes(k)) out = out.split(k).join(v)
  }
  return out
}

export function translateAll(units: TransUnit[], fn: (t: string) => string = mockTranslate): Record<string, string> {
  const map: Record<string, string> = {}
  for (const u of units) map[u.id] = fn(u.text)
  return map
}
