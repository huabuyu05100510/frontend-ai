/**
 * 翻译分块合并逻辑 —— node:test
 *
 * 启动：node --test test/translate.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { translateBatches, chunk } from '../lib/translate.mjs'

// ─── chunk 纯函数 ─────────────────────────────────────
test('chunk: 空数组 → 空', () => {
  assert.deepEqual(chunk([], 5), [])
})

test('chunk: 长度小于 batchSize → 一块', () => {
  assert.deepEqual(chunk([1, 2, 3], 5), [[1, 2, 3]])
})

test('chunk: 长度等于 batchSize → 一块', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 5), [[1, 2, 3, 4, 5]])
})

test('chunk: 长度大于 batchSize → 多块，最后一块可能更短', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]])
})

// ─── translateBatches ─────────────────────────────────
test('translateBatches: 空 → 空', async () => {
  const out = await translateBatches([], '中文', async () => [])
  assert.deepEqual(out, [])
})

test('translateBatches: ≤BATCH_SIZE → 只调一次', async () => {
  let calls = 0
  const segs = Array.from({ length: 10 }, (_, i) => `s${i}`)
  const out = await translateBatches(segs, '中文', async (batch) => {
    calls++
    return batch.map(s => `译-${s}`)
  })
  assert.equal(calls, 1)
  assert.equal(out.length, 10)
  assert.equal(out[0], '译-s0')
  assert.equal(out[9], '译-s9')
})

test('translateBatches: >BATCH_SIZE → 分多块并行，顺序保持', async () => {
  let calls = 0
  // 50 段 → 20+20+10 = 3 批
  const segs = Array.from({ length: 50 }, (_, i) => `s${i}`)
  const out = await translateBatches(segs, '中文', async (batch, idx) => {
    calls++
    // 模拟不同耗时，但必须按 idx 顺序返回
    if (idx === 0) await new Promise(r => setTimeout(r, 30))
    if (idx === 2) await new Promise(r => setTimeout(r, 5))
    return batch.map(s => `译-${s}`)
  })
  assert.equal(calls, 3)
  assert.equal(out.length, 50)
  // 顺序必须保留：第 0 段是 s0 的译文，第 49 段是 s49 的译文
  assert.equal(out[0], '译-s0')
  assert.equal(out[19], '译-s19')
  assert.equal(out[20], '译-s20')
  assert.equal(out[39], '译-s39')
  assert.equal(out[40], '译-s40')
  assert.equal(out[49], '译-s49')
})

test('translateBatches: 单批失败 → 其他批仍成功，失败位置填空字符串', async () => {
  const segs = Array.from({ length: 30 }, (_, i) => `s${i}`)
  const out = await translateBatches(segs, '中文', async (batch, idx) => {
    if (idx === 1) throw new Error('第 2 批 API 502')
    return batch.map(s => `译-${s}`)
  })
  assert.equal(out.length, 30)
  assert.equal(out[0], '译-s0')
  assert.equal(out[19], '译-s19')
  assert.equal(out[20], '', '第 2 批失败 → 第 20 段填空')
  assert.equal(out[29], '', '第 2 批失败 → 第 29 段填空')
})

test('translateBatches: callApi 返回段数少于 batch → 缺失填空（保护 N+1）', async () => {
  const segs = ['a', 'b', 'c']
  const out = await translateBatches(segs, '中文', async () => ['only-one'])
  assert.equal(out.length, 3)
  assert.equal(out[0], 'only-one')
  assert.equal(out[1], '')
  assert.equal(out[2], '')
})