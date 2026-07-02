// server/test/word-diff.test.mjs
// 模型：claude-sonnet-4-6
// Phase A.1: 词级 diff (wordDiff) — 给前端用 [start,end] 字符偏移 + ops
//
// 覆盖：CJK 字符 / ASCII 词 / 中英混排 / 数字 / 空文本 / 极长文本性能 / langPair 参数 / char-level offsets
import { describe, it, expect } from 'vitest'
import { wordDiff } from '../src/diff.mjs'

describe('wordDiff — 词级 diff (Phase A.1)', () => {
  it('空 src / 空 tgt 返回空', () => {
    const r = wordDiff('', '')
    expect(r.ops).toEqual([])
    expect(r.srcTokens).toEqual([])
    expect(r.tgtTokens).toEqual([])
  })

  it('纯中文：按字切分后 diff', () => {
    const r = wordDiff('你好世界', '你好我')
    // srcTokens = ['你','好','世','界']
    // tgtTokens = ['你','好','我']
    // 期望 ops: equal '你', equal '好', delete '世' '界', insert '我'
    expect(r.srcTokens).toEqual(['你', '好', '世', '界'])
    expect(r.tgtTokens).toEqual(['你', '好', '我'])
    const ops = r.ops.map((o) => `${o.op}:${o.text}`).join('|')
    expect(ops).toContain('equal:你')
    expect(ops).toContain('equal:好')
    expect(ops).toContain('delete:世')
    expect(ops).toContain('delete:界')
    expect(ops).toContain('insert:我')
  })

  it('纯英文：按词切分后 diff', () => {
    const r = wordDiff('Hello world test', 'Hello there test')
    // tokens: ['Hello','world','test'] vs ['Hello','there','test']
    expect(r.srcTokens).toContain('Hello')
    expect(r.srcTokens).toContain('world')
    expect(r.tgtTokens).toContain('there')
    const ops = r.ops.map((o) => `${o.op}:${o.text}`).join('|')
    expect(ops).toContain('equal:Hello')
    expect(ops).toContain('delete:world')
    expect(ops).toContain('insert:there')
    expect(ops).toContain('equal:test')
  })

  it('中英混排', () => {
    const r = wordDiff('前端工程师负责 React 开发', 'Frontend engineer handles React development')
    // CJK 按字切分，React 是 alpha 词
    expect(r.srcTokens).toEqual(['前', '端', '工', '程', '师', '负', '责', 'React', '开', '发'])
    expect(r.tgtTokens).toContain('Frontend')
    expect(r.tgtTokens).toContain('engineer')
    expect(r.tgtTokens).toContain('React')
    // React 在两边都存在，应 equal
    const ops = r.ops.map((o) => `${o.op}:${o.text}`).join('|')
    expect(ops).toContain('equal:React')
  })

  it('数字保持为 token', () => {
    const r = wordDiff('共 123 项', 'total 123 items')
    expect(r.srcTokens).toContain('123')
    expect(r.tgtTokens).toContain('123')
    const ops = r.ops.map((o) => `${o.op}:${o.text}`).join('|')
    expect(ops).toContain('equal:123')
  })

  it('srcOffsets / tgtOffsets 字符偏移正确（unicode code points）', () => {
    const r = wordDiff('a bc', 'a xyz')
    // srcTokens = ['a', 'bc']
    // src = 'a bc'  →  'a' at [0,1), 'bc' at [2,4)
    // tgt = 'a xyz' →  'a' at [0,1), 'xyz' at [2,5)
    const aOffset = r.srcOffsets[r.srcTokens.indexOf('a')]
    const bcOffset = r.srcOffsets[r.srcTokens.indexOf('bc')]
    expect(aOffset).toEqual([0, 1])
    expect(bcOffset).toEqual([2, 4])
    const aTgtOffset = r.tgtOffsets[r.tgtTokens.indexOf('a')]
    const xyzOffset = r.tgtOffsets[r.tgtTokens.indexOf('xyz')]
    expect(aTgtOffset).toEqual([0, 1])
    expect(xyzOffset).toEqual([2, 5])
  })

  it('srcChars / tgtChars 总字符数（code points）', () => {
    const r = wordDiff('你好', 'hello')
    expect(r.srcChars).toBe(2)
    expect(r.tgtChars).toBe(5)
  })

  it('langPair 参数不影响结果（保留为可观测字段）', () => {
    const r1 = wordDiff('你好', 'hello', ['zh', 'en'])
    const r2 = wordDiff('你好', 'hello', ['en', 'zh'])
    // 同样输入 → 同样 token / ops
    expect(r1.ops).toEqual(r2.ops)
    expect(r1.langPair).toEqual(['zh', 'en'])
    expect(r2.langPair).toEqual(['en', 'zh'])
  })

  it('极长文本性能：5k 字符 < 200ms', () => {
    const long = 'Hello world '.repeat(500)  // 6000 chars
    const long2 = 'Hello there '.repeat(500)
    const t0 = Date.now()
    const r = wordDiff(long, long2)
    const ms = Date.now() - t0
    expect(ms).toBeLessThan(200)
    expect(r.srcTokens.length).toBeGreaterThanOrEqual(1000)
    expect(r.ms).toBeLessThanOrEqual(ms + 5)  // ms 字段应记录
  })

  it('完全相同文本 → 全部 equal', () => {
    const r = wordDiff('hello world', 'hello world')
    expect(r.ops.every((o) => o.op === 'equal')).toBe(true)
  })

  it('unicode normalization：emoji 不会破坏 diff', () => {
    const r = wordDiff('👋 hello', '👋 world')
    // srcTokens = ['👋', 'hello']
    // tgtTokens = ['👋', 'world']
    const ops = r.ops.map((o) => `${o.op}:${o.text}`).join('|')
    expect(ops).toContain('equal:👋')
    expect(ops).toContain('delete:hello')
    expect(ops).toContain('insert:world')
  })
})
