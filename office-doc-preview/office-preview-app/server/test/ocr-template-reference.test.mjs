// OCR 模板 referenceFields（自研 iocr 锚点）单元测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTemplate,
  getTemplate,
  listTemplates,
  _resetForTests,
} from '../src/ocr-template.mjs'

beforeEach(() => {
  _resetForTests()
})

const baseFields = [
  { name: '发票号码', type: 'string', x: 200, y: 100, w: 360, h: 60 },
  { name: '开票日期', type: 'date', x: 220, y: 200, w: 280, h: 50 },
]

const baseRefs = [
  { name: '发票号码标签', text: '发票号码', x: 50, y: 100, w: 100, h: 24 },
  { name: '开票日期标签', text: '开票日期', x: 50, y: 200, w: 100, h: 24 },
]

describe('OCR 模板 — 自研 iocr referenceFields', () => {
  it('不带 referenceFields → 默认为空数组', () => {
    const tpl = createTemplate({
      name: 'VAT 专用发票',
      scenario: 'finance',
      fields: baseFields,
    })
    expect(tpl.referenceFields).toEqual([])
    expect(tpl.fields.length).toBe(2)
    // 持久化：再次读取能恢复
    const got = getTemplate(tpl.id)
    expect(got.referenceFields).toEqual([])
  })

  it('带 referenceFields → 持久化锚点 + 分配 id', () => {
    const tpl = createTemplate({
      name: 'VAT 专用发票',
      scenario: 'finance',
      referenceFields: baseRefs,
      fields: baseFields,
    })
    expect(tpl.referenceFields.length).toBe(2)
    for (const r of tpl.referenceFields) {
      expect(r.id).toMatch(/^r_/)
      expect(typeof r.name).toBe('string')
      expect(typeof r.text).toBe('string')
      expect(typeof r.x).toBe('number')
      expect(typeof r.y).toBe('number')
      expect(typeof r.w).toBe('number')
      expect(typeof r.h).toBe('number')
    }
    // 持久化
    const got = getTemplate(tpl.id)
    expect(got.referenceFields.length).toBe(2)
    expect(got.referenceFields[0].text).toBe('发票号码')
  })

  it('referenceField 缺 text → throw', () => {
    expect(() =>
      createTemplate({
        name: 'X',
        scenario: 'finance',
        referenceFields: [{ name: '发票号码标签', x: 50, y: 100, w: 100, h: 24 }],
        fields: baseFields,
      })
    ).toThrow(/text required/)
  })

  it('referenceField 缺 name → throw', () => {
    expect(() =>
      createTemplate({
        name: 'X',
        scenario: 'finance',
        referenceFields: [{ text: '发票号码', x: 50, y: 100, w: 100, h: 24 }],
        fields: baseFields,
      })
    ).toThrow(/name required/)
  })

  it('referenceField 非数字坐标 → throw', () => {
    expect(() =>
      createTemplate({
        name: 'X',
        scenario: 'finance',
        referenceFields: [{ name: 'r1', text: 't1', x: '50', y: 100, w: 100, h: 24 }],
        fields: baseFields,
      })
    ).toThrow(/referenceField\.x must be number/)
  })

  it('referenceFields 不是数组 → throw', () => {
    expect(() =>
      createTemplate({
        name: 'X',
        scenario: 'finance',
        referenceFields: { foo: 'bar' },
        fields: baseFields,
      })
    ).toThrow(/referenceFields must be array/)
  })

  it('listTemplates 返回含 referenceFields 的完整模板', () => {
    const tpl = createTemplate({
      name: 'With Anchors',
      scenario: 'medical',
      referenceFields: baseRefs,
      fields: baseFields,
    })
    const items = listTemplates()
    expect(items.length).toBe(1)
    expect(items[0].referenceFields.length).toBe(2)
  })

  it('多模板按 updatedAt 降序', async () => {
    const t1 = createTemplate({ name: 'A', scenario: 'finance', fields: baseFields })
    // 等一下让 updatedAt 不一致
    await new Promise(r => setTimeout(r, 5))
    const t2 = createTemplate({ name: 'B', scenario: 'finance', referenceFields: baseRefs, fields: baseFields })
    const items = listTemplates()
    expect(items.map(t => t.id)).toEqual([t2.id, t1.id])
  })
})
