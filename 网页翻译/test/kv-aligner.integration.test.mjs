/**
 * kv-aligner 集成测试 — 真实 opus-mt 模型
 *
 * 验证：lib/kv-aligner.mjs 在真实 ONNX 模型上能跑通
 *
 * 模型：Claude (Sonnet 4.5)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import ort from 'onnxruntime-node'
import { extractCrossAttentionKeys, averageHeads, similarityMatrix } from '../lib/kv-aligner.mjs'

const MODEL_CACHE = 'spike/word-alignment/node_modules/@huggingface/transformers/.cache/Xenova/opus-mt-en-zh/onnx'

test('integration: 真实 opus-mt 提取 6 层 cross-attention K', async () => {
  const dec = await ort.InferenceSession.create(`${MODEL_CACHE}/decoder_model_merged.onnx`)
  const enc = await ort.InferenceSession.create(`${MODEL_CACHE}/encoder_model.onnx`)

  // "fox" 单 token 测试，简单稳定
  const srcIds = [10950]  // "fox" 的 token id（示例，实际可能不同）

  // 跑 encoder
  const encFeeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(srcIds.map(BigInt)), [1, srcIds.length]),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from([1n]), [1, 1]),
  }
  const encOut = await enc.run(encFeeds)
  const encHidden = encOut[Object.keys(encOut)[0]]

  // 跑 decoder（teacher-forcing，喂个 BOS）
  const tgtIds = [2n]  // BOS
  const decFeeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(tgtIds), [1, tgtIds.length]),
    encoder_attention_mask: encFeeds.attention_mask,
    encoder_hidden_states: encHidden,
    use_cache_branch: new ort.Tensor('bool', [false], [1]),
  }
  // past_key_values 占位（merged 模型首步忽略）
  for (const name of dec.inputNames) {
    if (name.startsWith('past_key_values')) {
      decFeeds[name] = new ort.Tensor('float32', new Float32Array(0), [1, 8, 0, 64])
    }
  }
  const decOut = await dec.run(decFeeds)

  // 提取 K
  const keys = extractCrossAttentionKeys(decOut)
  assert.ok(keys.length >= 6, `应至少 6 层，实际 ${keys.length}`)

  // 最后一层多头平均
  const last = keys[keys.length - 1]
  const { vectors, srcLen, dim } = averageHeads(last.tensor)
  assert.equal(srcLen, 1)  // 单 src token
  assert.equal(dim, 64)    // MarianMT head dim
  assert.equal(vectors.length, 1)

  // K 不应为全 0
  const norm = Math.sqrt(vectors[0].reduce((a, b) => a + b * b, 0))
  assert.ok(norm > 0.1, `K 不应近 0，实际 norm=${norm}`)
})
