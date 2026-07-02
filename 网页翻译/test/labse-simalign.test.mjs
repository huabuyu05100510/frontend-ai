/**
 * lib/labse-simalign.mjs 单测
 * 跑：node --test test/labse-simalign.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  argmax, itermax, growDiag, simAlign, cosine, buildSimMatrix,
} from '../lib/labse-simalign.mjs'

// ── cosine ────────────────────────────────────────────
test('cosine: 相同方向 = 1，正交 = 0', () => {
  assert.equal(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9, true)
  assert.equal(Math.abs(cosine([1, 0], [0, 1])) < 1e-9, true)
  assert.equal(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-9, true)
})

// ── buildSimMatrix ─────────────────────────────────────
test('buildSimMatrix: 形状 [src_len][tgt_len]', () => {
  const sim = buildSimMatrix([[1, 0], [0, 1]], [[1, 0], [0, 1], [1, 1]])
  assert.equal(sim.length, 2)
  assert.equal(sim[0].length, 3)
  assert.ok(sim[0][0] > 0.99)
})

// ── argmax ─────────────────────────────────────────────
test('argmax: 单行单列双向命中', () => {
  // 2x2 矩阵，src0→tgt1 (0.9), src1→tgt0 (0.8)
  const sim = [[0.1, 0.9], [0.8, 0.1]]
  const r = argmax(sim)
  assert.equal(r.length, 2)
  const pairs = new Set(r.map(p => `${p.srcIdx}-${p.tgtIdx}`))
  assert.ok(pairs.has('0-1'))
  assert.ok(pairs.has('1-0'))
})

test('argmax: 空矩阵返回空数组', () => {
  assert.deepEqual(argmax([]), [])
})

// ── itermax ────────────────────────────────────────────
test('itermax: 输出对齐数 ≤ min(src_len, tgt_len)', () => {
  const sim = [
    [0.9, 0.1, 0.2],
    [0.1, 0.8, 0.3],
    [0.2, 0.1, 0.7],
    [0.1, 0.1, 0.1],
  ]
  const r = itermax(sim)
  assert.ok(r.length <= 3, `期望 ≤ 3，实际 ${r.length}`)
  // 每个 src/tgt 至多用一次
  const srcSeen = new Set()
  const tgtSeen = new Set()
  for (const p of r) {
    assert.ok(!srcSeen.has(p.srcIdx), `src ${p.srcIdx} 重复对齐`)
    assert.ok(!tgtSeen.has(p.tgtIdx), `tgt ${p.tgtIdx} 重复对齐`)
    srcSeen.add(p.srcIdx)
    tgtSeen.add(p.tgtIdx)
  }
})

test('itermax: 主对角线明显占优时全部命中主对角', () => {
  const sim = [
    [0.9, 0.1, 0.1],
    [0.1, 0.9, 0.1],
    [0.1, 0.1, 0.9],
  ]
  const r = itermax(sim)
  const pairs = new Set(r.map(p => `${p.srcIdx}-${p.tgtIdx}`))
  assert.ok(pairs.has('0-0'))
  assert.ok(pairs.has('1-1'))
  assert.ok(pairs.has('2-2'))
})

// ── growDiag ──────────────────────────────────────────
test('growDiag: 单种子不动', () => {
  const sim = [
    [0.9, 0.1],
    [0.1, 0.8],
  ]
  const seed = [{ srcIdx: 0, tgtIdx: 0, score: 0.9 }]
  const r = growDiag(sim, seed)
  // 至少保留种子
  const has = r.some(p => p.srcIdx === 0 && p.tgtIdx === 0)
  assert.ok(has)
})

// ── simAlign 三策略 ───────────────────────────────────
test('simAlign: intersect 比 union 更严格', () => {
  // 构造一个 argmax 和 itermax 不完全一致的 case
  const sim = [
    [0.6, 0.5, 0.1],
    [0.4, 0.7, 0.2],
    [0.1, 0.1, 0.9],
  ]
  const u = simAlign(sim, { strategy: 'union' })
  const i = simAlign(sim, { strategy: 'intersect' })
  assert.ok(i.length <= u.length, `intersect(${i.length}) 应 ≤ union(${u.length})`)
})

test('simAlign: grow_diag 策略返回非空', () => {
  const sim = [
    [0.9, 0.1],
    [0.1, 0.8],
  ]
  const r = simAlign(sim, { strategy: 'grow_diag' })
  assert.ok(r.length >= 1)
})

// ── 鲁棒性：边界 ─────────────────────────────────────
test('argmax: 单元素矩阵', () => {
  const r = argmax([[0.5]])
  assert.equal(r.length, 1)
  assert.equal(r[0].srcIdx, 0)
  assert.equal(r[0].tgtIdx, 0)
})

test('simAlign: argmax 默认策略返回多对一对齐', () => {
  // 2 src / 3 tgt，多对一：tgt0 tgt1 都对齐 src0
  const sim = [
    [0.95, 0.90, 0.10], // src0 强对齐 tgt0, tgt1
    [0.10, 0.20, 0.95], // src1 强对齐 tgt2
  ]
  const r = simAlign(sim) // 默认 argmax
  assert.ok(r.length >= 3, `argmax 应允许多对一，期望 ≥3 对，实际 ${r.length}`)
})

test('simAlign: 单 token 对单 token', () => {
  const r = simAlign([[0.9]])
  assert.equal(r.length, 1)
})

test('buildSimMatrix + simAlign 端到端', () => {
  // src0 ≈ tgt0, src1 ≈ tgt1
  const srcEmb = [[1, 0, 0], [0, 1, 0]]
  const tgtEmb = [[0.99, 0.01, 0], [0, 0.99, 0.01]]
  const sim = buildSimMatrix(srcEmb, tgtEmb)
  const r = simAlign(sim)
  assert.ok(r.length >= 1)
  // 至少一对正确（0-0 或 1-1）
  const correct = r.filter(p => p.srcIdx === p.tgtIdx).length
  assert.ok(correct >= 1, `期望至少 1 个对角对齐，实际 ${correct}`)
})
