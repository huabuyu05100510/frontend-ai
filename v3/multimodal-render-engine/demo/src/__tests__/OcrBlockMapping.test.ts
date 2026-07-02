import { describe, test, expect } from 'vitest'
import { roleToBlockType, ocrBlocksToTextBlocks } from '../scenes/ocr-general/blockTypeMapping'
import type { OcrBlock } from '../scenes/ocr-general/blockTypeMapping'

describe('roleToBlockType', () => {
  test('title → heading', () => {
    expect(roleToBlockType('title')).toBe('heading')
  })

  test('subtitle → heading', () => {
    expect(roleToBlockType('subtitle')).toBe('heading')
  })

  test('field → cell', () => {
    expect(roleToBlockType('field')).toBe('cell')
  })

  test('body → paragraph', () => {
    expect(roleToBlockType('body')).toBe('paragraph')
  })

  test('separator → separator', () => {
    expect(roleToBlockType('separator')).toBe('separator')
  })
})

describe('ocrBlocksToTextBlocks', () => {
  const nW = 595
  const nH = 842

  test('bbox 按自然尺寸反归一化', () => {
    const blocks: OcrBlock[] = [{
      role: 'body',
      text: 'Hello',
      confidence: 0.95,
      bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.06 },
    }]
    const result = ocrBlocksToTextBlocks(blocks, nW, nH)
    expect(result[0].bbox.x).toBeCloseTo(0.1 * nW)
    expect(result[0].bbox.y).toBeCloseTo(0.2 * nH)
    expect(result[0].bbox.w).toBeCloseTo(0.5 * nW)
    expect(result[0].bbox.h).toBeCloseTo(0.06 * nH)
  })

  test('confidence 字段保留（含低置信度）', () => {
    const blocks: OcrBlock[] = [{
      role: 'body', text: 'low conf', confidence: 0.6,
      bbox: { x: 0, y: 0, w: 0.5, h: 0.05 },
    }]
    const result = ocrBlocksToTextBlocks(blocks, nW, nH)
    expect(result[0].confidence).toBe(0.6)
  })

  test('field role 保留 label 字段', () => {
    const blocks: OcrBlock[] = [{
      role: 'field', text: '2024-03-15', confidence: 0.98, label: '开票日期',
      bbox: { x: 0.03, y: 0.12, w: 0.45, h: 0.07 },
    }]
    const result = ocrBlocksToTextBlocks(blocks, nW, nH)
    expect(result[0].label).toBe('开票日期')
    expect(result[0].type).toBe('cell')
  })

  test('每个 block 都有唯一 id', () => {
    const blocks: OcrBlock[] = [
      { role: 'title', text: 'A', confidence: 1, bbox: { x: 0, y: 0, w: 0.5, h: 0.05 } },
      { role: 'body',  text: 'B', confidence: 1, bbox: { x: 0, y: 0.1, w: 0.5, h: 0.05 } },
    ]
    const result = ocrBlocksToTextBlocks(blocks, nW, nH)
    const ids = result.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('separator role 不带 text 内容（text 为空字符串）', () => {
    const blocks: OcrBlock[] = [{
      role: 'separator', text: '', confidence: 1,
      bbox: { x: 0, y: 0.3, w: 1, h: 0.005 },
    }]
    const result = ocrBlocksToTextBlocks(blocks, nW, nH)
    expect(result[0].type).toBe('separator')
    expect(result[0].text).toBe('')
  })
})
