/**
 * lib/marian-crossattn-aligner.mjs 单测
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSpecialToken, trimSpecialTokens, alignWithCrossAttn, remapToOriginal,
} from '../lib/marian-crossattn-aligner.mjs'

test('isSpecialToken: 识别 Marian 特殊 token', () => {
  assert.equal(isSpecialToken('</s>'), true)
  assert.equal(isSpecialToken('<pad>'), true)
  assert.equal(isSpecialToken('>>cmn<<'), true)
  assert.equal(isSpecialToken('▁Hello'), false)
  assert.equal(isSpecialToken('world'), false)
  assert.equal(isSpecialToken(''), true)
})

test('trimSpecialTokens: 去掉首尾特殊 token', () => {
  const crossAttn = [
    [0.1, 0.1, 0.1, 0.1], // tgt[0]=</s> 特殊
    [0.5, 0.3, 0.2, 0.0], // tgt[1]=我
    [0.1, 0.6, 0.3, 0.0], // tgt[2]=爱
    [0.0, 0.1, 0.9, 0.0], // tgt[3]=</s> 特殊
  ]
  const tgtTokens = ['</s>', '我', '爱', '</s>']
  const srcTokens = ['▁I', 'love', 'you', '</s>']
  const { trimmed, tgtIdxMap, srcIdxMap } = trimSpecialTokens(crossAttn, tgtTokens, srcTokens)
  assert.deepEqual(tgtIdxMap, [1, 2])
  assert.deepEqual(srcIdxMap, [0, 1, 2])
  assert.equal(trimmed.length, 2)
  assert.equal(trimmed[0].length, 3)
})

test('alignWithCrossAttn: 完美对角矩阵 → 全部主对角对齐', () => {
  const fixture = {
    srcTokens: ['▁I', 'love', 'you'],
    tgtTokens: ['我', '爱', '你'],
    crossAttn: [
      [0.95, 0.03, 0.02],
      [0.05, 0.90, 0.05],
      [0.02, 0.08, 0.90],
    ],
  }
  const r = alignWithCrossAttn(fixture)
  assert.ok(r.length >= 3)
  // 至少 3 个主对角对齐
  const diag = r.filter(p => p.srcIdx === p.tgtIdx)
  assert.ok(diag.length >= 3, `期望 ≥3 对角对齐，实际 ${diag.length}`)
})

test('alignWithCrossAttn: 多对一（"敏捷"→quick）支持', () => {
  // tgt "敏" "捷" 都对 src "quick"（idx 1）高 attention
  const fixture = {
    srcTokens: ['the', 'quick', 'fox'],
    tgtTokens: ['敏', '捷', '狐'],
    crossAttn: [
      [0.05, 0.90, 0.05], // 敏 → quick
      [0.05, 0.92, 0.03], // 捷 → quick
      [0.02, 0.05, 0.93], // 狐 → fox
    ],
  }
  const r = alignWithCrossAttn(fixture)
  const pairs = new Set(r.map(p => `${p.tgtIdx}-${p.srcIdx}`))
  assert.ok(pairs.has('0-1'), '敏→quick')
  assert.ok(pairs.has('1-1'), '捷→quick')
  assert.ok(pairs.has('2-2'), '狐→fox')
})

test('remapToOriginal: 局部索引 → 原始索引', () => {
  const pairs = [{ srcIdx: 0, tgtIdx: 0, score: 0.9 }]
  const tgtIdxMap = [1, 2] // 局部 0 → 原始 1
  const srcIdxMap = [2, 3] // 局部 0 → 原始 2
  const r = remapToOriginal(pairs, tgtIdxMap, srcIdxMap)
  assert.equal(r[0].tgtIdx, 1)
  assert.equal(r[0].srcIdx, 2)
})

test('alignWithCrossAttn: 处理 attention 矩阵含 0 行（未对齐）', () => {
  const fixture = {
    srcTokens: ['hello'],
    tgtTokens: ['你好'],
    crossAttn: [[1.0]],
  }
  const r = alignWithCrossAttn(fixture)
  assert.equal(r.length, 1)
})
