// ocr.mjs 单元测试 — OCR 识别 + 对比 + 准确率
// 模型：claude-sonnet-4-6

import { describe, it, expect } from 'vitest'
import { compareOCRResults, ocrAccuracy } from '../src/ocr.mjs'

describe('ocrAccuracy', () => {
  it('perfect match returns 1.0', () => {
    const r = ocrAccuracy('你好世界', '你好世界')
    expect(r.accuracy).toBe(1)
    expect(r.precision).toBe(1)
    expect(r.recall).toBe(1)
    expect(r.f1).toBe(1)
  })

  it('partial match', () => {
    const r = ocrAccuracy('你好世界', '你好师姐')
    expect(r.accuracy).toBeLessThan(1)
    expect(r.accuracy).toBeGreaterThan(0)
    expect(r.precision).toBe(0.5)
  })

  it('completely different', () => {
    const r = ocrAccuracy('你好', 'ab')
    expect(r.accuracy).toBe(0)
    expect(r.f1).toBe(0)
  })

  it('empty strings', () => {
    const r = ocrAccuracy('', '')
    expect(r.accuracy).toBe(1)
  })

  it('one empty one not', () => {
    const r1 = ocrAccuracy('你好', '')
    expect(r1.recall).toBe(0)
    const r2 = ocrAccuracy('', '你好')
    expect(r2.precision).toBe(0)
  })

  it('long text comparison', () => {
    const ref = '这是一段比较长的文本用于测试OCR识别准确率'
    const test = '这是一段比较长的文本用于测试OCR识别准确率' // 完全相同
    const r = ocrAccuracy(ref, test)
    expect(r.accuracy).toBe(1)
    expect(r.f1).toBe(1)
  })

  it('handles special characters', () => {
    const r = ocrAccuracy('Hello, 世界！', 'Hello, 世界!')
    expect(r.accuracy).toBeLessThan(1)
    // ！和 ! 不同
  })
})

describe('compareOCRResults', () => {
  it('identical text yields no errors', () => {
    const r = compareOCRResults('测试文本', '测试文本')
    expect(r.errors).toHaveLength(0)
  })

  it('missing character detection', () => {
    const r = compareOCRResults('测试文本', '测试文')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors.some(e => e.type === 'missing')).toBe(true)
  })

  it('extra character detection', () => {
    const r = compareOCRResults('测试文', '测试文本')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors.some(e => e.type === 'extra')).toBe(true)
  })

  it('substitution detection', () => {
    const r = compareOCRResults('你好世界', '你好师姐')
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('empty reference', () => {
    const r = compareOCRResults('', '你好')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors.every(e => e.type === 'extra')).toBe(true)
  })

  it('empty test', () => {
    const r = compareOCRResults('你好', '')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors.every(e => e.type === 'missing')).toBe(true)
  })

  it('both empty', () => {
    const r = compareOCRResults('', '')
    expect(r.errors).toHaveLength(0)
  })

  it('returns meta info', () => {
    const r = compareOCRResults('你好世界', '你好师姐')
    expect(r.meta).toBeTruthy()
    expect(r.meta.referenceLength).toBe(4)
    expect(r.meta.ocrLength).toBe(4)
  })

  it('performance is reasonable', () => {
    const ref = 'A'.repeat(1000)
    const test = 'B'.repeat(1000)
    const t0 = Date.now()
    const r = compareOCRResults(ref, test)
    expect(Date.now() - t0).toBeLessThan(500) // should be fast
    expect(r.errors.length).toBeGreaterThan(0)
  })
})