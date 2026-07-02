import { describe, it, expect } from 'vitest'
import { colToIndex, indexToCol, parseA1, parseSharedStrings, parseSheet } from '../xlsx'

describe('列字母 ↔ 索引', () => {
  it('colToIndex', () => {
    expect(colToIndex('A')).toBe(0)
    expect(colToIndex('Z')).toBe(25)
    expect(colToIndex('AA')).toBe(26)
    expect(colToIndex('AB')).toBe(27)
  })
  it('parseA1', () => {
    expect(parseA1('A1')).toEqual({ r: 0, c: 0 })
    expect(parseA1('B3')).toEqual({ r: 2, c: 1 })
    expect(parseA1('AA10')).toEqual({ r: 9, c: 26 })
  })
  it('indexToCol 与 colToIndex 互逆', () => {
    expect(indexToCol(0)).toBe('A')
    expect(indexToCol(25)).toBe('Z')
    expect(indexToCol(26)).toBe('AA')
    expect(indexToCol(27)).toBe('AB')
    expect(indexToCol(701)).toBe('ZZ')
    for (const c of ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']) {
      expect(indexToCol(colToIndex(c))).toBe(c)
    }
  })
})

describe('parseSharedStrings', () => {
  it('解析简单与多 run 的共享字符串', () => {
    const xml =
      '<sst><si><t>苹果</t></si><si><r><t>Hello </t></r><r><t>World</t></r></si></sst>'
    expect(parseSharedStrings(xml)).toEqual(['苹果', 'Hello World'])
  })
  it('空表返回空数组', () => {
    expect(parseSharedStrings('<sst/>')).toEqual([])
  })
})

describe('parseSheet', () => {
  const shared = ['苹果', '香蕉']
  const sheet =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2"><v>3.14</v></c><c r="B2" t="inlineStr"><is><t>内联</t></is></c></row>' +
    '</sheetData></worksheet>'

  it('共享字符串、数字、内联字符串均正确取值', () => {
    const m = parseSheet('Sheet1', sheet, shared)
    expect(m.name).toBe('Sheet1')
    expect(m.cells.get('0,0')?.text).toBe('苹果')
    expect(m.cells.get('0,1')?.text).toBe('香蕉')
    expect(m.cells.get('1,0')?.text).toBe('3.14')
    expect(m.cells.get('1,1')?.text).toBe('内联')
  })

  it('行列数为最大下标+1', () => {
    const m = parseSheet('S', sheet, shared)
    expect(m.rows).toBe(2)
    expect(m.cols).toBe(2)
  })

  it('空 sheet 行列为 0', () => {
    const m = parseSheet('S', '<worksheet><sheetData/></worksheet>', [])
    expect(m.rows).toBe(0)
    expect(m.cols).toBe(0)
    expect(m.cells.size).toBe(0)
  })
})
