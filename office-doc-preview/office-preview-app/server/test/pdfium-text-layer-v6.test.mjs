// pdfium-text-layer.mjs — v6 fullDoc global offset 文字层测试
// 模型：claude-sonnet-4-6
//
// v6 与 v5 差异：
//   - v5：per-page charMap（srcStart/srcEnd 在单页内）
//   - v6：fullDoc global charMap（srcStart/srcEnd 是 fullDoc 内全局 offset）
//   - pageSlice 参数让 v6 能按页切分 fullDoc 文字层
//   - data-pdfium="6"

import { describe, it, expect } from 'vitest'
import { buildFullDocTextLayer } from '../src/pdfium-text-layer.mjs'

// ============ 1. 0 runs → 空 v6 层 ============
describe('buildFullDocTextLayer — v6 fullDoc charMap', () => {
  it('1. 0 runs → 空 v6 层（data-pdfium="6"）', () => {
    const html = buildFullDocTextLayer([], 800, 1100, '', [], { pageCharStart: 0, pageCharEnd: 0 })
    expect(html).toContain('data-pdfium="6"')
    expect(html).toContain('data-page-w="800.00"')
    expect(html).toContain('data-page-h="1100.00"')
    expect(html).not.toContain('<span')
  })

  it('2. 单 run 单 char → 1 span with global idx', () => {
    const runs = [{ str: 'A', left: 10, right: 30, top: 100, bottom: 120, fontSize: 14 }]
    const fullTgt = 'A'
    // fullDoc 1 char, page 0..1
    const globalCharMap = [{ srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 }]
    const html = buildFullDocTextLayer(runs, 800, 1100, fullTgt, globalCharMap, { pageCharStart: 0, pageCharEnd: 1 })
    expect(html).toContain('data-pdfium="6"')
    expect(html).toMatch(/<span[^>]+data-tgt-idx="0"[^>]+data-src-idx="0"[^>]*>A<\/span>/)
  })

  it('3. 单 run 多 char → N spans 等宽切分 + 全局 offset 连续', () => {
    // "ABC" run, 宽 60px（每 char 20px）
    const runs = [{ str: 'ABC', left: 0, right: 60, top: 100, bottom: 120, fontSize: 14 }]
    const fullTgt = 'ABC'
    const globalCharMap = [{ srcStart: 0, srcEnd: 3, tgtStart: 0, tgtEnd: 3 }]
    const html = buildFullDocTextLayer(runs, 800, 1100, fullTgt, globalCharMap, { pageCharStart: 0, pageCharEnd: 3 })
    // 应该有 3 个 span，tgt-idx 0/1/2，src-idx 0/1/2
    const spanMatches = html.match(/<span[^>]+><\/span>/g) || html.match(/<span[^>]+>[^<]*<\/span>/g)
    expect(spanMatches.length).toBe(3)
    expect(html).toContain('data-tgt-idx="0"')
    expect(html).toContain('data-tgt-idx="1"')
    expect(html).toContain('data-tgt-idx="2"')
  })

  it('4. 多 run → spans 按 run 拼接 + 全局 offset', () => {
    // 两个 run: "AB" 和 "CD"（全 doc 4 chars）
    const runs = [
      { str: 'AB', left: 0, right: 40, top: 100, bottom: 120, fontSize: 14 },
      { str: 'CD', left: 50, right: 90, top: 100, bottom: 120, fontSize: 14 },
    ]
    const fullTgt = 'ABCD'
    const globalCharMap = [{ srcStart: 0, srcEnd: 4, tgtStart: 0, tgtEnd: 4 }]
    const html = buildFullDocTextLayer(runs, 800, 1100, fullTgt, globalCharMap, { pageCharStart: 0, pageCharEnd: 4 })
    const spanMatches = html.match(/<span[^>]+data-(tgt|src)-idx="\d+"[^>]*>[^<]*<\/span>/g) || []
    expect(spanMatches.length).toBe(4)
    // 0,1,2,3 全局 offset 都应该出现
    expect(html).toContain('data-tgt-idx="0"')
    expect(html).toContain('data-tgt-idx="1"')
    expect(html).toContain('data-tgt-idx="2"')
    expect(html).toContain('data-tgt-idx="3"')
  })

  it('5. pageSlice 偏移 → tgtSearchPos 落到 page 起点', () => {
    // fullDoc = "ABCDE" (5 chars), page 2 是 chars [2, 3] = "CD"
    // page 2 的 runs = "CD" (相对 fullDoc offset 2-4)
    const runs = [{ str: 'CD', left: 0, right: 40, top: 100, bottom: 120, fontSize: 14 }]
    const fullTgt = 'ABCDE'
    const globalCharMap = [{ srcStart: 0, srcEnd: 5, tgtStart: 0, tgtEnd: 5 }]
    const html = buildFullDocTextLayer(runs, 800, 1100, fullTgt, globalCharMap, { pageCharStart: 2, pageCharEnd: 4 })
    // 应该有 2 个 span，tgt-idx 2 和 3
    expect(html).toContain('data-tgt-idx="2"')
    expect(html).toContain('data-tgt-idx="3"')
    expect(html).not.toContain('data-tgt-idx="0"')
    expect(html).not.toContain('data-tgt-idx="4"')
  })

  it('6. identity charMap per-char → src-idx 跟 tgt-idx 一致', () => {
    // identity: 每个 char 自己映射到自己（per-char charMap）
    const runs = [{ str: 'WXYZ', left: 0, right: 80, top: 100, bottom: 120, fontSize: 14 }]
    const fullTgt = 'WXYZ'
    const globalCharMap = [
      { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
      { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
      { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
      { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 },
    ]
    const html = buildFullDocTextLayer(runs, 800, 1100, fullTgt, globalCharMap, { pageCharStart: 0, pageCharEnd: 4 })
    // 每个 span 的 src-idx 应等于 tgt-idx（identity per-char）
    expect(html).toContain('data-tgt-idx="0" data-src-idx="0"')
    expect(html).toContain('data-tgt-idx="1" data-src-idx="1"')
    expect(html).toContain('data-tgt-idx="2" data-src-idx="2"')
    expect(html).toContain('data-tgt-idx="3" data-src-idx="3"')
  })
})
