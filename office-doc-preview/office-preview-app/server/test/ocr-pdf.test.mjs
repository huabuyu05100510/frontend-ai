// 可搜索 PDF 生成 — 纯函数测试
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { generateSearchablePdf } from '../src/ocr-pdf.mjs'

describe('generateSearchablePdf', () => {
  it('基础纯文本生成最小合法 PDF（含 EOF 标记）', () => {
    const buf = generateSearchablePdf({
      text: 'Hello OCR World',
      title: 'Hello OCR',
      pageSize: 'A4',
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    const s = buf.toString('latin1')
    expect(s.startsWith('%PDF-')).toBe(true)
    expect(s.includes('Hello OCR World')).toBe(true)
    expect(s.trim().endsWith('%%EOF')).toBe(true)
  })

  it('包含 DocumentCatalog + Pages + Page + Content 必备对象', () => {
    const buf = generateSearchablePdf({ text: 'test', title: 't' })
    const s = buf.toString('latin1')
    expect(s).toMatch(/\/Type\s*\/Catalog/)
    expect(s).toMatch(/\/Type\s*\/Pages/)
    expect(s).toMatch(/\/Type\s*\/Page[^s]/)
    expect(s).toMatch(/\/Contents\s+\d+\s+\d+\s+R/)
  })

  it('包含 PDF 元信息（Title/Producer）', () => {
    const buf = generateSearchablePdf({ text: 't', title: 'My Invoice' })
    const s = buf.toString('latin1')
    expect(s).toContain('/Title')
    expect(s).toContain('My Invoice')
    expect(s).toContain('/Producer')
  })

  it('CJK 标题 → UTF-16BE hex 编码（PDF Unicode 兼容）', () => {
    const buf = generateSearchablePdf({ text: 't', title: '我的发票' })
    const s = buf.toString('latin1')
    // UTF-16BE 用 hex 字符串 + BOM (\xFE\xFF) 表达
    expect(s.toLowerCase()).toMatch(/<feff[0-9a-f]+>/)
    expect(s).toContain('/Title')
  })

  it('按 region 坐标在 PDF 中定位每段文字（positioned text）', () => {
    const buf = generateSearchablePdf({
      text: 'Hello World',
      title: 'pos',
      imageSize: { width: 800, height: 600 },
      regions: [
        { text: 'Hello', x: 100, y: 100, width: 100, height: 30 },
        { text: 'World', x: 220, y: 100, width: 80, height: 30 },
      ],
    })
    const s = buf.toString('latin1')
    // 文字应出现两次（Hello + World）
    const helloCount = (s.match(/Hello/g) || []).length
    const worldCount = (s.match(/World/g) || []).length
    expect(helloCount).toBeGreaterThanOrEqual(1)
    expect(worldCount).toBeGreaterThanOrEqual(1)
    // BT/ET 文字展示操作符存在
    expect(s).toContain('BT')  // Begin Text
    expect(s).toContain('ET')  // End Text
    // Tm text matrix 操作符
    expect(s).toMatch(/\d+(\.\d+)?\s+\d+(\.\d+)?\s+Tm/)
  })

  it('无 regions 时退化为单页全文本', () => {
    const buf = generateSearchablePdf({
      text: 'fallback only',
      title: 'fb',
    })
    const s = buf.toString('latin1')
    expect(s).toContain('fallback only')
    expect(s).toContain('BT')
  })

  it('支持换行（\\n）—— 多行布局', () => {
    const buf = generateSearchablePdf({
      text: 'line1\nline2\nline3',
      title: 'multi',
    })
    const s = buf.toString('latin1')
    expect(s).toContain('line1')
    expect(s).toContain('line2')
    expect(s).toContain('line3')
    // 多行应有多个 BT/ET
    const btCount = (s.match(/BT/g) || []).length
    expect(btCount).toBeGreaterThanOrEqual(3)
  })

  it('返回 Buffer 体积合理（<1MB 对 100 区域）', () => {
    const big = {
      text: 'x'.repeat(5000),
      title: 'big',
      regions: Array.from({ length: 100 }, (_, i) => ({
        text: 'r' + i, x: 50 + i * 5, y: 50, width: 40, height: 20,
      })),
    }
    const buf = generateSearchablePdf(big)
    expect(buf.length).toBeLessThan(1 * 1024 * 1024)
  })
})
