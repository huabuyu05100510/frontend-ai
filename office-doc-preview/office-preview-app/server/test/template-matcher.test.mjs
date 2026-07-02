// 自研 iocr 模板匹配引擎 — 核心算法单元测试
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { matchTemplate, textSimilarity, computeTransform, findRegionsInBox } from '../src/template-matcher.mjs'

// 模拟 OCR regions（百度通用 OCR 返回结构，已归一化为 {text, x, y, w, h}）
const SAMPLE_REGIONS = [
  // 左上角："发票号码 12345678"
  { text: '发票号码', x: 100, y: 100, w: 80, h: 24 },
  { text: '12345678', x: 200, y: 100, w: 90, h: 24 },
  // 中间："开票日期 2024-03-15"
  { text: '开票日期', x: 100, y: 200, w: 80, h: 24 },
  { text: '2024-03-15', x: 200, y: 200, w: 100, h: 24 },
  // 下方："价税合计（大写）人民币壹仟元整"
  { text: '价税合计', x: 100, y: 400, w: 80, h: 24 },
  { text: '¥1000.00', x: 200, y: 400, w: 90, h: 24 },
]

// 模板：参照字段（在样例图上画的框 + 实际文字）
const TEMPLATE = {
  referenceFields: [
    { id: 'r1', name: '发票号码标签', text: '发票号码', x: 50, y: 50, w: 80, h: 24 },
    { id: 'r2', name: '开票日期标签', text: '开票日期', x: 50, y: 150, w: 80, h: 24 },
    { id: 'r3', name: '价税合计标签', text: '价税合计', x: 50, y: 350, w: 80, h: 24 },
  ],
  fields: [
    { id: 'f1', name: '发票号码', type: 'string', x: 150, y: 50, w: 100, h: 24 },
    { id: 'f2', name: '开票日期', type: 'date', x: 150, y: 150, w: 110, h: 24 },
    { id: 'f3', name: '价税合计', type: 'number', x: 150, y: 350, w: 100, h: 24 },
  ],
}

describe('textSimilarity', () => {
  it('完全相同 → 1.0', () => {
    expect(textSimilarity('发票号码', '发票号码')).toBeCloseTo(1.0, 5)
  })

  it('完全无关 → 0', () => {
    expect(textSimilarity('发票号码', '价税合计')).toBeLessThan(0.3)
  })

  it('包含关系 → 高分', () => {
    const s = textSimilarity('发票号码', '发票号码：')
    expect(s).toBeGreaterThan(0.7)
  })

  it('空字符串 → 0', () => {
    expect(textSimilarity('', 'abc')).toBe(0)
    expect(textSimilarity('abc', '')).toBe(0)
  })
})

describe('computeTransform', () => {
  it('完全对齐 → offset=(0,0) scale=1', () => {
    const anchors = [
      { template: { x: 10, y: 10, w: 50, h: 20 }, matched: { x: 10, y: 10, w: 50, h: 20 }, score: 1 },
    ]
    const t = computeTransform(anchors)
    expect(t.offsetX).toBeCloseTo(0, 0)
    expect(t.offsetY).toBeCloseTo(0, 0)
    expect(t.scaleX).toBeCloseTo(1, 1)
    expect(t.scaleY).toBeCloseTo(1, 1)
  })

  it('平移 (50,100) → offset=(50,100)', () => {
    const anchors = [
      { template: { x: 0, y: 0, w: 50, h: 20 }, matched: { x: 50, y: 100, w: 50, h: 20 }, score: 1 },
      { template: { x: 100, y: 50, w: 50, h: 20 }, matched: { x: 150, y: 150, w: 50, h: 20 }, score: 1 },
    ]
    const t = computeTransform(anchors)
    expect(t.offsetX).toBeCloseTo(50, -1)
    expect(t.offsetY).toBeCloseTo(100, -1)
  })

  it('无锚点 → 单位变换', () => {
    const t = computeTransform([])
    expect(t.offsetX).toBe(0)
    expect(t.offsetY).toBe(0)
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
  })

  it('用中位数过滤离群点', () => {
    // 3 个锚点，1 个偏差很大
    const anchors = [
      { template: { x: 0, y: 0, w: 50, h: 20 }, matched: { x: 50, y: 50, w: 50, h: 20 }, score: 1 },
      { template: { x: 100, y: 0, w: 50, h: 20 }, matched: { x: 150, y: 50, w: 50, h: 20 }, score: 1 },
      { template: { x: 200, y: 0, w: 50, h: 20 }, matched: { x: 700, y: 600, w: 50, h: 20 }, score: 0.3 }, // 离群
    ]
    const t = computeTransform(anchors)
    expect(t.offsetX).toBeCloseTo(50, -1)  // 中位数，不受离群影响
    expect(t.offsetY).toBeCloseTo(50, -1)
  })
})

describe('findRegionsInBox', () => {
  it('返回中心在 box 内的 regions', () => {
    const box = { x: 180, y: 90, w: 120, h: 40 }
    const matched = findRegionsInBox(SAMPLE_REGIONS, box)
    // 12345678 (center 245, 112) 在 box 内
    expect(matched.some(r => r.text === '12345678')).toBe(true)
    // 发票号码 (center 140, 112) 在 box 外
    expect(matched.some(r => r.text === '发票号码')).toBe(false)
  })

  it('按阅读顺序排序（先 y 后 x）', () => {
    const regions = [
      { text: 'B', x: 100, y: 100, w: 10, h: 10 },
      { text: 'A', x: 50, y: 100, w: 10, h: 10 },
      { text: 'C', x: 50, y: 50, w: 10, h: 10 },
    ]
    const box = { x: 0, y: 0, w: 200, h: 200 }
    const result = findRegionsInBox(regions, box)
    expect(result.map(r => r.text)).toEqual(['C', 'A', 'B'])
  })
})

describe('matchTemplate', () => {
  it('完整匹配 → 提取所有字段', () => {
    const r = matchTemplate({ regions: SAMPLE_REGIONS, template: TEMPLATE })
    expect(r.alignmentScore).toBeGreaterThan(0.5)
    expect(r.fields.length).toBe(3)

    const byName = Object.fromEntries(r.fields.map(f => [f.name, f.value]))
    expect(byName['发票号码']).toContain('12345678')
    expect(byName['开票日期']).toContain('2024-03-15')
    expect(byName['价税合计']).toContain('1000')
  })

  it('锚点匹配诊断：每个 referenceField 有 matched 标志', () => {
    const r = matchTemplate({ regions: SAMPLE_REGIONS, template: TEMPLATE })
    expect(r.anchors.length).toBe(3)
    for (const a of r.anchors) {
      expect(a.matched).toBe(true)
      expect(typeof a.score).toBe('number')
      expect(a.score).toBeGreaterThan(0.5)
    }
  })

  it('模板无 referenceFields → 直接按坐标提取（offset=0）', () => {
    const tpl = { referenceFields: [], fields: TEMPLATE.fields }
    const r = matchTemplate({ regions: SAMPLE_REGIONS, template: tpl })
    expect(r.transform.offsetX).toBe(0)
    expect(r.fields.length).toBe(3)
  })

  it('图片有偏移 → 通过锚点自动对齐', () => {
    // 把所有 region 整体右下移动 (50, 80)
    const shiftedRegions = SAMPLE_REGIONS.map(r => ({ ...r, x: r.x + 50, y: r.y + 80 }))
    const r = matchTemplate({ regions: shiftedRegions, template: TEMPLATE })
    expect(r.alignmentScore).toBeGreaterThan(0.5)
    // baseline offset (template→原图) = +50；再 +50 平移 = +100
    expect(r.transform.offsetX).toBeCloseTo(100, -1)
    expect(r.transform.offsetY).toBeCloseTo(130, -1)  // baseline 50 + 80
    // 字段仍能提取
    const byName = Object.fromEntries(r.fields.map(f => [f.name, f.value]))
    expect(byName['发票号码']).toContain('12345678')
  })

  it('低质量锚点匹配（OCR 全错）→ alignmentScore 低', () => {
    const garbageRegions = [
      { text: 'xxxxx', x: 100, y: 100, w: 80, h: 24 },
      { text: 'yyyyy', x: 200, y: 100, w: 90, h: 24 },
    ]
    const r = matchTemplate({ regions: garbageRegions, template: TEMPLATE })
    expect(r.alignmentScore).toBeLessThan(0.3)
  })

  it('返回 transform + alignmentScore 诊断字段', () => {
    const r = matchTemplate({ regions: SAMPLE_REGIONS, template: TEMPLATE })
    expect(r.transform).toBeTruthy()
    expect(typeof r.transform.offsetX).toBe('number')
    expect(typeof r.alignmentScore).toBe('number')
  })
})
