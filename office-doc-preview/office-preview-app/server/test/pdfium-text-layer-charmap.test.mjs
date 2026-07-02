// buildTextLayerWithCharMap 单元测试
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { buildTextLayerWithCharMap } from '../src/pdfium-text-layer.mjs'

describe('buildTextLayerWithCharMap — 字符级 data 属性', () => {
  it('空 runs → 空 text-layer（保留 data-pdfium=5）', () => {
    const html = buildTextLayerWithCharMap([], 1239, 1752, '', [])
    expect(html).toContain('data-pdfium="5"')
    expect(html).toContain('data-page-w="1239.00"')
    expect(html).toContain('data-page-h="1752.00"')
  })

  it('单 run "Hello" + charMap 1 段 → 5 个 char span，每个带 data-tgt-idx 和 data-src-idx', () => {
    const runs = [{ str: 'Hello', left: 0, right: 100, top: 0, bottom: 20, fontSize: 14 }]
    const charMap = [{ srcStart: 0, srcEnd: 2, tgtStart: 0, tgtEnd: 5 }]  // 假设 src "你好" → tgt "Hello"
    const html = buildTextLayerWithCharMap(runs, 1239, 1752, 'Hello', charMap)
    // 5 个 span
    const spanMatches = html.match(/<span /g) || []
    expect(spanMatches).toHaveLength(5)
    // 0~4 都有 data-tgt-idx
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`data-tgt-idx="${i}"`)
    }
    // 所有 5 个 char 的 data-src-idx 都是 0（因为 Hello 对应的 src 是 0~2，从 0 开始）
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`data-tgt-idx="${i}" data-src-idx="0"`)
    }
  })

  it('多 run + 多段 charMap → 每个 char span 都有正确的 src 映射', () => {
    const runs = [
      { str: 'Hello', left: 0, right: 100, top: 0, bottom: 20, fontSize: 14 },
      { str: ' ', left: 100, right: 110, top: 0, bottom: 20, fontSize: 14 },
      { str: 'World', left: 110, right: 200, top: 0, bottom: 20, fontSize: 14 },
    ]
    const charMap = [
      { srcStart: 0, srcEnd: 2, tgtStart: 0, tgtEnd: 5 },   // 你好 → Hello
      { srcStart: 2, srcEnd: 3, tgtStart: 5, tgtEnd: 6 },   // 空 → ' '
      { srcStart: 3, srcEnd: 5, tgtStart: 6, tgtEnd: 11 },  // 世界 → World
    ]
    const html = buildTextLayerWithCharMap(runs, 1239, 1752, 'Hello World', charMap)

    // 11 个 char span (Hello + 空格 + World)
    const spanMatches = html.match(/<span /g) || []
    expect(spanMatches).toHaveLength(11)

    // Hello (0-4) → src 0
    // 空格 (5) → src 2
    // World (6-10) → src 3
    expect(html).toContain('data-tgt-idx="0" data-src-idx="0"')  // H
    expect(html).toContain('data-tgt-idx="4" data-src-idx="0"')  // o
    expect(html).toContain('data-tgt-idx="5" data-src-idx="2"')  // 空格
    expect(html).toContain('data-tgt-idx="6" data-src-idx="3"')  // W
    expect(html).toContain('data-tgt-idx="10" data-src-idx="3"')  // d
  })

  it('run 找不到 in targetText 时降级为整 run span（无 char-level data）', () => {
    const runs = [
      { str: 'Unknown', left: 0, right: 100, top: 0, bottom: 20, fontSize: 14 },
    ]
    const charMap = [{ srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 }]
    const html = buildTextLayerWithCharMap(runs, 1239, 1752, 'different text', charMap)
    // 降级：1 个 span（无 data-tgt-idx）
    const spanMatches = html.match(/<span /g) || []
    expect(spanMatches).toHaveLength(1)
    expect(html).not.toContain('data-tgt-idx=')
  })

  it('char span 仍保留绝对定位 + font-size（视觉与 PDFium 引擎一致）', () => {
    const runs = [{ str: 'Hi', left: 50, right: 100, top: 30, bottom: 50, fontSize: 18 }]
    const charMap = [{ srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 2 }]
    const html = buildTextLayerWithCharMap(runs, 1239, 1752, 'Hi', charMap)
    // 包含 absolute 定位 + font-size
    expect(html).toMatch(/style="[^"]*position:absolute/)
    expect(html).toMatch(/font-size:18\.00px/)
  })
})
