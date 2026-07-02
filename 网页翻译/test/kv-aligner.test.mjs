/**
 * kv-aligner 单测
 *
 * 对标 docs/depth-strategy-v3.md
 *
 * 模型：Claude (Sonnet 4.5)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import ort from 'onnxruntime-node'
import {
  extractCrossAttentionKeys,
  averageHeads,
  cosine,
  similarityMatrix,
  alignByFingerprint,
  fullAttention,
  evaluateAlignment,
} from '../lib/kv-aligner.mjs'

// 构造假 K tensor [1, heads, src_len, head_dim]
function mockK(heads, srcLen, headDim, fillFn) {
  const data = new Float32Array(heads * srcLen * headDim)
  let idx = 0
  for (let h = 0; h < heads; h++) {
    for (let s = 0; s < srcLen; s++) {
      for (let d = 0; d < headDim; d++) {
        data[idx++] = fillFn(h, s, d)
      }
    }
  }
  return new ort.Tensor('float32', data, [1, heads, srcLen, headDim])
}

// ─── extractCrossAttentionKeys ─────────────────────────
test('extractCrossAttentionKeys: 提取所有 present.N.encoder.key', () => {
  const fake = {
    'logits': new ort.Tensor('float32', new Float32Array(1), [1, 1, 1]),
    'present.0.encoder.key': new ort.Tensor('float32', new Float32Array(8), [1, 1, 1, 8]),
    'present.0.encoder.value': new ort.Tensor('float32', new Float32Array(8), [1, 1, 1, 8]),
    'present.1.encoder.key': new ort.Tensor('float32', new Float32Array(8), [1, 1, 1, 8]),
    'present.2.encoder.key': new ort.Tensor('float32', new Float32Array(8), [1, 1, 1, 8]),
    'present.1.decoder.key': new ort.Tensor('float32', new Float32Array(8), [1, 1, 1, 8]),
  }
  const keys = extractCrossAttentionKeys(fake)
  assert.equal(keys.length, 3)
  assert.deepEqual(keys.map(k => k.layer), [0, 1, 2])
})

test('extractCrossAttentionKeys: 无 K 时返回空数组', () => {
  assert.deepEqual(extractCrossAttentionKeys({}), [])
})

// ─── averageHeads ──────────────────────────────────────
test('averageHeads: 多头平均正确', () => {
  // 2 heads, 2 src tokens, 3 dim
  // head 0: token0=[1,1,1], token1=[2,2,2]
  // head 1: token0=[3,3,3], token1=[4,4,4]
  // avg:    token0=[2,2,2], token1=[3,3,3]
  const k = mockK(2, 2, 3, (h, s, d) => h === 0 ? (s === 0 ? 1 : 2) : (s === 0 ? 3 : 4))
  const { vectors, srcLen, dim } = averageHeads(k)
  assert.equal(srcLen, 2)
  assert.equal(dim, 3)
  assert.deepEqual(Array.from(vectors[0]), [2, 2, 2])
  assert.deepEqual(Array.from(vectors[1]), [3, 3, 3])
})

test('averageHeads: 错误 shape 抛异常', () => {
  const bad = new ort.Tensor('float32', new Float32Array(6), [2, 3])
  assert.throws(() => averageHeads(bad), /expected \[1, heads, src, dim\]/)
})

// ─── cosine ────────────────────────────────────────────
test('cosine: 相同向量=1', () => {
  const v = new Float32Array([1, 2, 3])
  assert.equal(Math.round(cosine(v, v) * 1000) / 1000, 1)
})

test('cosine: 正交向量=0', () => {
  const a = new Float32Array([1, 0])
  const b = new Float32Array([0, 1])
  assert.ok(Math.abs(cosine(a, b)) < 1e-6)
})

test('cosine: 反向=-1', () => {
  const a = new Float32Array([1, 1])
  const b = new Float32Array([-1, -1])
  assert.equal(Math.round(cosine(a, b) * 1000) / 1000, -1)
})

// ─── similarityMatrix ──────────────────────────────────
test('similarityMatrix: 对角线=1，对称', () => {
  const v = [
    new Float32Array([1, 0]),
    new Float32Array([0, 1]),
    new Float32Array([1, 0]),
  ]
  const m = similarityMatrix(v)
  // 对角线
  m.forEach((row, i) => assert.equal(Math.round(row[i] * 1000) / 1000, 1))
  // 对称
  assert.ok(Math.abs(m[0][1] - m[1][0]) < 1e-6)
  // token0 和 token2 相同（都是 [1,0]）→ 相似度=1
  assert.equal(Math.round(m[0][2] * 1000) / 1000, 1)
})

// ─── alignByFingerprint ────────────────────────────────
test('alignByFingerprint: 找到最佳 src 对齐', () => {
  // src: 2 个不同方向向量
  const srcK = [
    new Float32Array([1, 0, 0]),   // src0
    new Float32Array([0, 1, 0]),   // src1
  ]
  // tgt 接近 src1
  const tgt = [
    new Float32Array([0, 0.9, 0.1]),
    new Float32Array([0.95, 0, 0.05]),
  ]
  const pairs = alignByFingerprint(srcK, tgt)
  assert.equal(pairs[0].srcIdx, 1)  // tgt0 接近 src1
  assert.equal(pairs[1].srcIdx, 0)  // tgt1 接近 src0
})

test('alignByFingerprint: threshold 过滤低分', () => {
  const srcK = [new Float32Array([1, 0, 0])]
  const tgt = [new Float32Array([0, 1, 0])]  // 正交，score=0
  const pairs = alignByFingerprint(srcK, tgt, { threshold: 0.5 })
  assert.equal(pairs.length, 0)
})

// ─── fullAttention ─────────────────────────────────────
test('fullAttention: 每行 softmax 求和=1', () => {
  const Q = [new Float32Array([1, 0]), new Float32Array([0, 1])]
  const K = [new Float32Array([1, 0]), new Float32Array([0, 1]), new Float32Array([1, 1])]
  const attn = fullAttention(Q, K)
  assert.equal(attn.length, 2)
  attn.forEach(row => {
    const sum = row.reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 1) < 1e-5, `row sum should be 1, got ${sum}`)
  })
})

// ─── evaluateAlignment ─────────────────────────────────
test('evaluateAlignment: 完美预测 P=R=F1=1', () => {
  const pred = [{ tgtIdx: 0, srcIdx: 1 }, { tgtIdx: 1, srcIdx: 0 }]
  const gold = [{ tgtIdx: 0, srcIdx: 1 }, { tgtIdx: 1, srcIdx: 0 }]
  const r = evaluateAlignment(pred, gold)
  assert.equal(r.precision, 1)
  assert.equal(r.recall, 1)
  assert.equal(r.f1, 1)
})

test('evaluateAlignment: 部分匹配', () => {
  const pred = [{ tgtIdx: 0, srcIdx: 0 }, { tgtIdx: 1, srcIdx: 1 }, { tgtIdx: 2, srcIdx: 2 }]
  const gold = [{ tgtIdx: 0, srcIdx: 0 }, { tgtIdx: 1, srcIdx: 2 }]
  const r = evaluateAlignment(pred, gold)
  // TP=1 (只 0-0 对)
  assert.equal(r.precision, 1 / 3)
  assert.equal(r.recall, 1 / 2)
})
