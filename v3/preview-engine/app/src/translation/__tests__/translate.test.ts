import { describe, it, expect } from 'vitest'
import {
  extractDocxUnits,
  extractSheetUnits,
  extractSlideUnits,
  applyTranslations,
  translateAll,
  mockTranslate,
} from '../translate'
import type { Block } from '../../ooxml/docx'
import type { SheetModel } from '../../ooxml/xlsx'
import type { Slide } from '../../ooxml/pptx'

describe('extractDocxUnits', () => {
  it('每个非空块一个可译单元，id 唯一', () => {
    const blocks: Block[] = [
      { type: 'heading', level: 1, runs: [{ text: '标题' }] },
      { type: 'paragraph', runs: [{ text: 'Hello ' }, { text: 'World' }] },
      { type: 'paragraph', runs: [] },
    ]
    const units = extractDocxUnits(blocks)
    expect(units).toEqual([
      { id: 'b0', text: '标题' },
      { id: 'b1', text: 'Hello World' },
    ])
  })
})

describe('extractSheetUnits', () => {
  it('每个单元格一个单元，id=r,c', () => {
    const cells = new Map([
      ['0,0', { r: 0, c: 0, text: '苹果' }],
      ['1,2', { r: 1, c: 2, text: 'X' }],
    ])
    const model: SheetModel = { name: 'S', rows: 2, cols: 3, cells }
    const units = extractSheetUnits(model)
    expect(units).toContainEqual({ id: '0,0', text: '苹果' })
    expect(units).toContainEqual({ id: '1,2', text: 'X' })
  })
})

describe('extractSlideUnits', () => {
  it('每个文本框一个单元，id=s{slide}.t{i}', () => {
    const t = (text: string, x = 0, y = 0) => ({ text, x, y, w: 0, h: 0, size: 18 })
    const slides: Slide[] = [
      { index: 0, texts: [t('A'), t('B', 1, 1)], images: [] },
      { index: 1, texts: [t('C')], images: [] },
    ]
    const units = extractSlideUnits(slides)
    expect(units.map((u) => u.id)).toEqual(['s0.t0', 's0.t1', 's1.t0'])
    expect(units[2].text).toBe('C')
  })
})

describe('applyTranslations', () => {
  it('按 id 回填译文，缺译回退原文', () => {
    const units = [
      { id: 'b0', text: '苹果' },
      { id: 'b1', text: '香蕉' },
    ]
    const out = applyTranslations(units, { b0: 'Apple' })
    expect(out).toEqual([
      { id: 'b0', source: '苹果', target: 'Apple' },
      { id: 'b1', source: '香蕉', target: '香蕉' },
    ])
  })
})

describe('mockTranslate / translateAll', () => {
  it('字典命中替换', () => {
    expect(mockTranslate('苹果')).toBe('Apple')
    expect(mockTranslate('我喜欢苹果和香蕉')).toBe('我喜欢Apple和Banana')
  })
  it('translateAll 产出 id→译文映射', () => {
    const map = translateAll([{ id: 'x', text: '苹果' }])
    expect(map).toEqual({ x: 'Apple' })
  })
})
