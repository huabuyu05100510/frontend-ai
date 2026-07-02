// diff.mjs v6 — 中文分词 + 短语错误检测 + AI 语义校对测试
// 模型：claude-sonnet-4-6

import { describe, it, expect } from 'vitest'
import {
  segmentWords,
  detectPhraseErrors,
  categorizeErrors,
  myersDiff,
  summarizeErrors,
} from '../src/diff.mjs'

describe('segmentWords — 中文分词', () => {
  it('空文本', () => {
    expect(segmentWords('')).toEqual([])
  })

  it('纯中文按字切分', () => {
    const r = segmentWords('你好世界')
    expect(r).toEqual(['你', '好', '世', '界'])
  })

  it('中英混排', () => {
    const r = segmentWords('Hello世界123')
    expect(r).toEqual(['Hello', '世', '界', '123'])
  })

  it('标点独立', () => {
    const r = segmentWords('你好，世界！')
    expect(r).toEqual(['你', '好', '，', '世', '界', '！'])
  })

  it('空白被过滤', () => {
    const r = segmentWords('你好 世界  Test')
    expect(r).toEqual(['你', '好', '世', '界', 'Test'])
  })

  it('纯英文按词', () => {
    const r = segmentWords('Hello World Test')
    expect(r).toEqual(['Hello', 'World', 'Test'])
  })

  it('数字和中文混排', () => {
    const r = segmentWords('第123号文件')
    expect(r).toEqual(['第', '123', '号', '文', '件'])
  })
})

describe('detectPhraseErrors — 短语错误检测', () => {
  it('完全相同的文本无错误', () => {
    const r = detectPhraseErrors('你好世界', '你好世界')
    expect(r).toEqual([])
  })

  it('单字替换（经 diff 合并后是 phrase 级）', () => {
    const r = detectPhraseErrors('你好世界', '你好师姐')
    expect(r.length).toBeGreaterThan(0)
    // Myers diff 会将相邻的 delete '世'+'界' 和 insert '师'+'姐' 合并
    expect(['spell', 'word_order', 'grammar']).toContain(r[0].type)
    expect(r[0].phrase).toBeTruthy()
    expect(r[0].suggestion).toBeTruthy()
  })

  it('冗余检测', () => {
    const r = detectPhraseErrors('你好世界啊', '你好世界')
    expect(r.length).toBeGreaterThan(0)
    const redundant = r.find(e => e.type === 'redundant')
    expect(redundant).toBeTruthy()
  })

  it('遗漏检测', () => {
    const r = detectPhraseErrors('你好世界', '你好世界啊')
    expect(r.length).toBeGreaterThan(0)
    const missing = r.find(e => e.type === 'missing')
    expect(missing).toBeTruthy()
  })

  it('语序错误（同长度短语替换）', () => {
    // "拼音检查" vs "音拼检查" - 2字符交换
    const r = detectPhraseErrors('拼音检查', '音拼检查')
    expect(r.length).toBeGreaterThan(0)
    // 一定检测到差异
    expect(r.some(e => e.phrase || e.suggestion)).toBe(true)
  })

  it('短语级替换（语法）', () => {
    const r = detectPhraseErrors('把书在桌子', '把书放在桌子上')
    expect(r.length).toBeGreaterThan(0)
    // diff 至少检测到有差异
    expect(r[0]).toBeTruthy()
  })

  it('空文本边界', () => {
    expect(detectPhraseErrors('', '')).toEqual([])
    // 空 vs 非空的短语错误检测：Myers diff 产生 insert 或 delete ops
    // detectPhraseErrors 能够捕获为 missing/redundant
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() => detectPhraseErrors('', 'hello')).not.toThrow()
    // eslint-disable-next-line jest/no-conditional-expect
    expect(() => detectPhraseErrors('hello', '')).not.toThrow()
  })
})

describe('categorizeErrors', () => {
  it('按类型分类', () => {
    const errors = [
      { id: 'e1', original: '错字', corrected: '正字', op: 'change' },
      { id: 'e2', original: '，', corrected: '。', op: 'change' },
      { id: 'e3', original: '', corrected: '漏字', op: 'insert' },
    ]
    const cats = categorizeErrors(errors)
    expect(cats.length).toBeGreaterThan(0)
    // 检查分类结构
    for (const cat of cats) {
      expect(cat.id).toBeTruthy()
      expect(cat.label).toBeTruthy()
      expect(cat.count).toBeGreaterThan(0)
      expect(Array.isArray(cat.errors)).toBe(true)
    }
  })
})

describe('myersDiff + summarizeErrors round-trip', () => {
  it('char-level diff round-trip', () => {
    const a = '原文和译文应该是相同的格式'
    const b = '原文和译文格式应该是一样的'
    const ops = myersDiff(a, b)
    const errors = summarizeErrors(ops)
    expect(errors.length).toBeGreaterThan(0)

    // round-trip 不变式：filter(!insert) → 原左
    const left = ops.filter(o => o.op !== 'insert').map(o => o.text).join('')
    expect(left).toBe(a)
    // round-trip 不变式：filter(!delete) → 原右
    const right = ops.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(right).toBe(b)
  })
})

describe('categorizeErrors summary', () => {
  it('correctly counts error types', () => {
    const errors = [
      { id: 'e1', original: '错字', corrected: '正字', op: 'change' },
      { id: 'e2', original: '误字', corrected: '正确', op: 'change' },
      { id: 'e3', original: ',', corrected: '，', op: 'change' },
      { id: 'e4', original: '长句错误的文本', corrected: '长句正确的文本', op: 'change' },
      { id: 'e5', original: '', corrected: '漏', op: 'insert' },
    ]
    const cats = categorizeErrors(errors)
    expect(cats.length).toBeGreaterThan(0)
    const totalErrors = cats.reduce((n, c) => n + c.count, 0)
    expect(totalErrors).toBe(5)
  })
})