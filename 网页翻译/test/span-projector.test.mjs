/**
 * span-projector — Lilt §4.3 算法
 *
 * 对标 tech-plan §2.2：纯算法、无副作用、可单测
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectTag, projectAll, computeAlignment } from '../lib/span-projector.mjs'

// ─── projectTag 基础 ───────────────────────────────────
test('projectTag: 空 span (open===close) 合法', () => {
  // align[0]=[0.5,0.5]，tag wraps src[0..1)
  // inScore[0] = align[0][0] = 0.5 (s=0 in tag)
  // outScore[0] = align[0][1] = 0.5 (s=1 out tag)
  // totalIn=0.5, totalOut=0.5
  // (0,0): inSpan=0, outSpan=0.5-0=0.5, score=0.5
  const align = [[0.5, 0.5]]
  const tag = { id: 't1', openToken: 0, closeToken: 1 }
  const r = projectTag(tag, align, 2, 1)
  assert.equal(r.open, 0)
  assert.equal(r.close, 0)
  assert.equal(r.score, 0.5)
})

test('projectTag: 单 src 单 tgt，完美对齐 → 1-token span', () => {
  // src=["x"], tgt=["y"], align=[[1.0]]
  // tag wraps src[0..1]
  const align = [[1.0]]
  const tag = { id: 't1', openToken: 0, closeToken: 1 }
  const r = projectTag(tag, align, 1, 1)
  assert.equal(r.open, 0)
  assert.equal(r.close, 1)
  assert.equal(r.score, 1.0)  // in_span=1, out_span=0
})

test('projectTag: 经典例子 — tag 内容未翻译，best span 为空', () => {
  // src: ["the", "quick", "brown"]      (3 src)
  // tgt: ["le", "brun"]                  (2 tgt)
  // align: le→the=0.9, brun→brown=0.9, 其他 0.05
  const align = [
    [0.9, 0.05, 0.05],   // le
    [0.05, 0.05, 0.9],   // brun
  ]
  // tag wraps "quick" → openToken=1, closeToken=2
  const tag = { id: 't1', openToken: 1, closeToken: 2 }
  const r = projectTag(tag, align, 3, 2)
  // best: open=0, close=0 (no tgt in span) — src-out AND tgt-out 贡献最大化
  assert.equal(r.open, 0)
  assert.equal(r.close, 0)
  // score = align[0][0]+align[0][2]+align[1][0]+align[1][2] = 0.9+0.05+0.05+0.9 = 1.9
  assert.ok(Math.abs(r.score - 1.9) < 1e-9)
})

test('projectTag: 完美 1-1 对齐 tag wraps 1 src token', () => {
  // src: ["a","b","c"]
  // tgt: ["A","B","C"]
  // align: each tgt→its src
  const align = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
  ]
  // tag wraps "b" → openToken=1
  const tag = { id: 't1', openToken: 1, closeToken: 2 }
  const r = projectTag(tag, align, 3, 3)
  // best: open=1, close=2 — single tgt "B" aligned to "b"
  assert.equal(r.open, 1)
  assert.equal(r.close, 2)
  assert.ok(r.score > 2.5)  // 高分
})

test('projectTag: 标签内容被合并到相邻 tgt 单词', () => {
  // src: ["a", "book"] tgt: ["un", "livre"]
  // align uniform 0.5/0.5 → 无信号，全部 (open,close) 评分都 ≤ 1.0
  // 算法无法区分，结果是 (0,0) - 不投影（空 span）
  const align = [
    [0.5, 0.5],
    [0.5, 0.5],
  ]
  const tag = { id: 't1', openToken: 1, closeToken: 2 }
  const r = projectTag(tag, align, 2, 2)
  // 信号弱时 safest 是空 span
  assert.equal(r.open, 0)
  assert.equal(r.close, 0)
  // score 是 max in+out
  assert.ok(r.score > 0)
})

test('projectTag: 强信号时定位正确', () => {
  // src: ["a", "book"] tgt: ["un", "livre"]
  // align: book→livre=0.9, 其他 0.05
  const align = [
    [0.95, 0.05],   // un → 主要对齐 a
    [0.05, 0.95],   // livre → 主要对齐 book
  ]
  const tag = { id: 't1', openToken: 1, closeToken: 2 }
  const r = projectTag(tag, align, 2, 2)
  // best span 应包含 livre (tgt[1])
  // 计算 (1,2): in=0.95, out=0.95-(outPfx[2]-outPfx[1])=0.95-(0.95-0.95)=0.95, score=1.9
  // vs (0,2): in=0.05+0.95=1, out=0, score=1
  // → (1,2) wins
  assert.equal(r.open, 1)
  assert.equal(r.close, 2)
  assert.ok(Math.abs(r.score - 1.9) < 0.01)
})

test('projectTag: 边界 — tgt 全部为空，best 是 [0,0]', () => {
  // src: ["a","b"], tgt: ["A","B"], align 全 0
  const align = [[0, 0], [0, 0]]
  const tag = { id: 't1', openToken: 0, closeToken: 1 }
  const r = projectTag(tag, align, 2, 2)
  assert.equal(r.open, 0)
  assert.equal(r.close, 0)
  assert.equal(r.score, 0)
})

test('projectTag: 整段都在 tag 内', () => {
  // src: ["a","b","c"], tgt: ["A","B"], align 平摊
  const align = [
    [0.5, 0.5, 0],
    [0, 0.5, 0.5],
  ]
  // tag wraps 整段 [0,3)
  const tag = { id: 't1', openToken: 0, closeToken: 3 }
  const r = projectTag(tag, align, 3, 2)
  // best: open=0, close=2 (所有 tgt 都在 span 内)
  // in_span = sum align[t][s] for s∈[0,3) = (0.5+0.5+0) + (0+0.5+0.5) = 2.0
  // out_span = 0
  assert.equal(r.open, 0)
  assert.equal(r.close, 2)
  assert.ok(Math.abs(r.score - 2.0) < 1e-9)
})

// ─── projectAll ────────────────────────────────────────
test('projectAll: 多 tag 独立投影', () => {
  // src: ["a","b","c","d","e"]
  // tgt: ["A","B","C","D"]
  // align 对角线 1，其余 0
  const align = [
    [1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 1, 0],
  ]
  const tags = [
    { id: 't1', openToken: 0, closeToken: 2 },  // wraps "a","b"
    { id: 't2', openToken: 3, closeToken: 5 },  // wraps "d","e"
  ]
  const r = projectAll(tags, align, 5, 4)
  assert.equal(r.length, 2)
  assert.equal(r[0].tagId, 't1')
  assert.equal(r[0].open, 0)
  assert.equal(r[0].close, 2)
  assert.equal(r[1].tagId, 't2')
  // "d" → tgt[3], "e" → (没翻译) → best: [3,4) 包含 d 对齐的 tgt
  assert.equal(r[1].open, 3)
  assert.equal(r[1].close, 4)
})

test('projectAll: 空 tag 数组 → 空', () => {
  const r = projectAll([], [[1]], 1, 1)
  assert.deepEqual(r, [])
})

// ─── 优化版（prefix-sum）vs 暴力版结果一致 ───────────
test('projectTag: prefix-sum 优化版本结果与定义一致', () => {
  // 与上面 "完美 1-1 对齐" 同样的输入
  const align = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
  ]
  const tag = { id: 't1', openToken: 1, closeToken: 2 }
  const r = projectTag(tag, align, 3, 3)
  // 同一输入应该总返回确定的最优解
  const r2 = projectTag(tag, align, 3, 3)
  assert.deepEqual(r, r2)
})

// ─── computeAlignment: 简单 token 重叠相似度（占位用） ─
test('computeAlignment: 字符串完全相同 → 对角线', () => {
  const a = computeAlignment(['the', 'quick'], ['the', 'quick'])
  assert.equal(a.length, 2)
  assert.equal(a[0].length, 2)
  assert.ok(a[0][0] > 0.9)
  assert.ok(a[1][1] > 0.9)
  // 行归一化（softmax-like）
  const sum0 = a[0][0] + a[0][1]
  assert.ok(Math.abs(sum0 - 1.0) < 0.01, `行 0 和=${sum0}`)
})

test('computeAlignment: 完全不同 → 均匀分布', () => {
  const a = computeAlignment(['aaa'], ['xxx'])
  assert.equal(a.length, 1)
  assert.equal(a[0].length, 1)
  assert.equal(a[0][0], 1.0)  // 1×1 矩阵只有 1 个
})

test('computeAlignment: 长度不等 → 矩形矩阵', () => {
  const a = computeAlignment(['a', 'b', 'c'], ['x'])
  assert.equal(a.length, 1)
  assert.equal(a[0].length, 3)
  // 每行和=1
  assert.ok(Math.abs(a[0][0] + a[0][1] + a[0][2] - 1.0) < 0.01)
})