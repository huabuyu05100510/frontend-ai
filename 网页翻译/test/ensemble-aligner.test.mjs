/**
 * lib/ensemble-aligner.mjs 单测
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensemble, monotonicCheck, evaluateF1 } from '../lib/ensemble-aligner.mjs'

test('ensemble: 空输入返回空', () => {
  assert.deepEqual(ensemble([]), [])
})

test('ensemble: 单路退化直接返回', () => {
  const r = ensemble([{
    name: 'A', weight: 1,
    pairs: [
      { tgtIdx: 0, srcIdx: 1, score: 0.9 },
      { tgtIdx: 1, srcIdx: 0, score: 0.8 },
    ],
  }])
  assert.equal(r.length, 2)
  assert.equal(r[0].srcIdx, 1)
  assert.equal(r[1].srcIdx, 0)
  assert.equal(r[0].agreement, 1)
})

test('ensemble: 多路一致 → agreement = N', () => {
  const r = ensemble([
    { name: 'A', weight: 0.5, pairs: [{ tgtIdx: 0, srcIdx: 1, score: 0.9 }] },
    { name: 'B', weight: 0.5, pairs: [{ tgtIdx: 0, srcIdx: 1, score: 0.85 }] },
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].agreement, 2)
  assert.equal(r[0].disagreement, 0)
})

test('ensemble: 路线分歧 → disagreement > 0', () => {
  const r = ensemble([
    { name: 'A', weight: 0.5, pairs: [{ tgtIdx: 0, srcIdx: 1, score: 0.9 }] },
    { name: 'B', weight: 0.5, pairs: [{ tgtIdx: 0, srcIdx: 2, score: 0.85 }] },
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].disagreement, 0.5)
})

test('ensemble: 加权投票时高分路占优', () => {
  // A 路 weight=0.9 投 src=5
  // B 路 weight=0.1 投 src=6
  // 但 A score=0.1, B score=0.9
  // weighted: A=0.9*0.1=0.09, B=0.1*0.9=0.09 → 平局，取其一
  // 改成 A=0.9*0.5=0.45, B=0.1*0.9=0.09 → A 占优
  const r = ensemble([
    { name: 'A', weight: 0.9, pairs: [{ tgtIdx: 0, srcIdx: 5, score: 0.5 }] },
    { name: 'B', weight: 0.1, pairs: [{ tgtIdx: 0, srcIdx: 6, score: 0.9 }] },
  ])
  assert.equal(r[0].srcIdx, 5)
})

test('monotonicCheck: 单调递增 ok', () => {
  const r = monotonicCheck([
    { tgtIdx: 0, srcIdx: 0 },
    { tgtIdx: 1, srcIdx: 2 },
    { tgtIdx: 2, srcIdx: 3 },
  ])
  assert.equal(r.ok, true)
  assert.equal(r.violations.length, 0)
})

test('monotonicCheck: 违反单调', () => {
  const r = monotonicCheck([
    { tgtIdx: 0, srcIdx: 5 },
    { tgtIdx: 1, srcIdx: 2 }, // ← 违反
  ])
  assert.equal(r.ok, false)
  assert.equal(r.violations.length, 1)
})

test('evaluateF1: 完美匹配 F1=1', () => {
  const r = evaluateF1(
    [{ tgtIdx: 0, srcIdx: 1 }, { tgtIdx: 1, srcIdx: 0 }],
    [{ tgtIdx: 0, srcIdx: 1 }, { tgtIdx: 1, srcIdx: 0 }],
  )
  assert.equal(r.tp, 2)
  assert.equal(r.fp, 0)
  assert.equal(r.fn, 0)
  assert.equal(r.f1, 1)
})

test('evaluateF1: 部分匹配', () => {
  const r = evaluateF1(
    [{ tgtIdx: 0, srcIdx: 1 }, { tgtIdx: 1, srcIdx: 2 }],
    [{ tgtIdx: 0, srcIdx: 1 }, { tgtIdx: 1, srcIdx: 0 }, { tgtIdx: 2, srcIdx: 2 }],
  )
  // tp=1, predCount=2, goldCount=3
  // precision=0.5, recall=1/3, f1=0.4
  assert.equal(r.tp, 1)
  assert.equal(r.precision, 0.5)
  assert.ok(Math.abs(r.recall - 1 / 3) < 1e-6)
  assert.ok(Math.abs(r.f1 - 0.4) < 1e-6)
})

test('evaluateF1: 空预测', () => {
  const r = evaluateF1([], [{ tgtIdx: 0, srcIdx: 1 }])
  assert.equal(r.f1, 0)
  assert.equal(r.recall, 0)
})
