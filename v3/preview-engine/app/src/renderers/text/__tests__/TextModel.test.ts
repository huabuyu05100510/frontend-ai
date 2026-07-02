import { describe, it, expect } from 'vitest'
import { TextModel } from '../TextModel'

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('TextModel.decode', () => {
  it('去除 UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('hello')])
    expect(TextModel.decode(withBom)).toBe('hello')
  })

  it('正常 UTF-8（含中文）', () => {
    expect(TextModel.decode(bytes('你好 world'))).toBe('你好 world')
  })

  it('空输入', () => {
    expect(TextModel.decode(new Uint8Array(0))).toBe('')
  })
})

describe('TextModel 行索引', () => {
  it('LF 分行', () => {
    const m = new TextModel('a\nb\nc')
    expect(m.lineCount).toBe(3)
    expect(m.getLines(0, 2)).toEqual(['a', 'b', 'c'])
  })

  it('CRLF 归一为行', () => {
    const m = new TextModel('a\r\nb\r\nc')
    expect(m.lineCount).toBe(3)
    expect(m.getLines(0, 2)).toEqual(['a', 'b', 'c'])
  })

  it('末行无换行', () => {
    const m = new TextModel('x\ny')
    expect(m.lineCount).toBe(2)
    expect(m.getLines(1, 1)).toEqual(['y'])
  })

  it('末行有换行 → 末尾空行', () => {
    const m = new TextModel('x\n')
    expect(m.lineCount).toBe(2)
    expect(m.getLines(0, 1)).toEqual(['x', ''])
  })

  it('空字符串 → 1 行空', () => {
    const m = new TextModel('')
    expect(m.lineCount).toBe(1)
    expect(m.getLines(0, 0)).toEqual([''])
  })

  it('区间取行（虚拟化）', () => {
    const m = new TextModel(Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n'))
    expect(m.lineCount).toBe(1000)
    expect(m.getLines(500, 502)).toEqual(['line 500', 'line 501', 'line 502'])
  })

  it('越界区间被夹紧', () => {
    const m = new TextModel('a\nb')
    expect(m.getLines(-5, 100)).toEqual(['a', 'b'])
  })
})
