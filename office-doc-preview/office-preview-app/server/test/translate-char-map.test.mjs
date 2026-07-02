// mockTranslateWithMap + charMap 单元测试
// 模型：claude-sonnet-4-6
//
// 设计目标：
//   1. 译文用源文件内容 mock（不再只是 [en] 前缀）
//   2. 字符级对应：每个 src 字符段 → 连续 tgt 字符段
//   3. charMap 长度守恒：src 总长 = 末段 srcEnd；tgt 总长 = 末段 tgtEnd
import { describe, it, expect } from 'vitest'
import { mockTranslateWithMap, SUPPORTED_LANGS } from '../src/translate.mjs'

describe('mockTranslateWithMap — 字典匹配 + charMap', () => {
  it('空字符串 → 空 target + 空 charMap', () => {
    const r = mockTranslateWithMap('', 'en')
    expect(r.target).toBe('')
    expect(r.charMap).toEqual([])
  })

  it('单字符 → charMap 长度为 1', () => {
    const r = mockTranslateWithMap('你', 'en')
    expect(r.charMap).toHaveLength(1)
    expect(r.charMap[0]).toMatchObject({ srcStart: 0, srcEnd: 1 })
    expect(r.charMap[0].tgtEnd - r.charMap[0].tgtStart).toBeGreaterThanOrEqual(1)
  })

  it('字典词匹配：「你好」→ "Hello"（1 dict entry），charMap 1 条', () => {
    const r = mockTranslateWithMap('你好', 'en')
    expect(r.target).toBe('Hello')
    expect(r.charMap).toEqual([
      { srcStart: 0, srcEnd: 2, tgtStart: 0, tgtEnd: 5 }
    ])
  })

  it('最大匹配优先：「你好世界」→ "Hello World"（不应拆成 "Hello" + 单字）', () => {
    const r = mockTranslateWithMap('你好世界', 'en')
    expect(r.target).toBe('Hello World')
    expect(r.charMap).toEqual([
      { srcStart: 0, srcEnd: 4, tgtStart: 0, tgtEnd: 11 }
    ])
  })

  it('部分匹配 + 回退：「你好小明」→ "Hello" + 单字', () => {
    const r = mockTranslateWithMap('你好小明', 'en')
    expect(r.target).toMatch(/^Hello/)
    expect(r.charMap[0]).toEqual({ srcStart: 0, srcEnd: 2, tgtStart: 0, tgtEnd: 5 })
    // 第 2 段：明（不在字典里 → 单字回退）
    expect(r.charMap.length).toBeGreaterThanOrEqual(2)
  })

  it('标点符号：句号 → ". "，带空格（英文标点后空格约定）', () => {
    const r = mockTranslateWithMap('。', 'en')
    expect(r.target).toMatch(/^\.\s*$/)
  })

  it('charMap 长度守恒：末段 srcEnd = src 字符数，末段 tgtEnd = tgt 字符数', () => {
    const src = '你好世界，这是测试。'
    const r = mockTranslateWithMap(src, 'en')
    const lastSrc = r.charMap[r.charMap.length - 1]
    expect(lastSrc.srcEnd).toBe(Array.from(src).length)
    expect(lastSrc.tgtEnd).toBe(Array.from(r.target).length)
  })

  it('charMap 段连续无重叠：每段 srcStart === 上一段 srcEnd', () => {
    const src = '你好世界，这是测试。'
    const r = mockTranslateWithMap(src, 'en')
    for (let i = 1; i < r.charMap.length; i++) {
      expect(r.charMap[i].srcStart).toBe(r.charMap[i - 1].srcEnd)
    }
  })

  it('charMap 段连续无重叠：tgt 段也连续', () => {
    const src = '你好世界，这是测试。'
    const r = mockTranslateWithMap(src, 'en')
    for (let i = 1; i < r.charMap.length; i++) {
      expect(r.charMap[i].tgtStart).toBe(r.charMap[i - 1].tgtEnd)
    }
  })

  it('不支持的目标语言 → 抛错', () => {
    expect(() => mockTranslateWithMap('hi', 'klingon')).toThrow()
  })

  it('同源不翻译：zh-CN → zh-CN 时 target === src（identity mock）', () => {
    const src = '你好'
    const r = mockTranslateWithMap(src, 'zh-CN')
    expect(r.target).toBe(src)
    // charMap 为 1:1 对应
    expect(r.charMap).toEqual([
      { srcStart: 0, srcEnd: 2, tgtStart: 0, tgtEnd: 2 }
    ])
  })

  it('英文原文：mock 不改英文单词', () => {
    const r = mockTranslateWithMap('Hello', 'en')
    expect(r.target).toBe('Hello')
  })

  it('回退：未在字典的单字 → 1:1 mock translation（非空且与 src 等长或近似）', () => {
    const r = mockTranslateWithMap('A', 'en')  // 英文单字 → 不动
    expect(r.target).toBe('A')

    const r2 = mockTranslateWithMap('明', 'en')  // 中文明
    expect(r2.target.length).toBeGreaterThan(0)
    // 单字回退不一定是 1:1（可能是 1:2 字母编码）
  })

  it('真实场景样本：「原文和译文应该是相同的格式」', () => {
    const src = '原文和译文应该是相同的格式'
    const r = mockTranslateWithMap(src, 'en')
    expect(r.target).toBeTruthy()
    expect(r.target).not.toBe(src)
    // target 应该是英文文本
    expect(r.target).toMatch(/^[A-Za-z\s.,!?]+$/)
    // charMap 覆盖完整
    const lastSrc = r.charMap[r.charMap.length - 1]
    expect(lastSrc.srcEnd).toBe(Array.from(src).length)
    expect(lastSrc.tgtEnd).toBe(Array.from(r.target).length)
  })
})

describe('SUPPORTED_LANGS', () => {
  it('包含 8 种目标语言', () => {
    expect(SUPPORTED_LANGS.size).toBe(8)
    for (const l of ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru']) {
      expect(SUPPORTED_LANGS.has(l)).toBe(true)
    }
  })
})
