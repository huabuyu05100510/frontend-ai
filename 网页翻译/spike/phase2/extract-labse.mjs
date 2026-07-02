/**
 * Phase 2 spike: 提取 LaBSE embedding，落 fixture JSON
 *
 * 输出：test/fixtures/labse-embeddings.json
 *   { cases: [{ src, tgt, srcTokens, tgtTokens, srcEmb: [[...]], tgtEmb: [[...]] }] }
 *
 * 供 lib/labse-simalign.mjs 单测 + benchmark 使用。
 */
import { pipeline, env } from '@huggingface/transformers'
import { writeFileSync } from 'node:fs'

env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const CASES = [
  { src: 'The quick brown fox jumps over the lazy dog', tgt: '敏捷的棕色狐狸跳过了懒狗' },
  { src: 'I love you', tgt: '我爱你' },
  { src: 'Hello world', tgt: '你好世界' },
  { src: 'The cat is sleeping', tgt: '猫在睡觉' },
  { src: 'Open the door', tgt: '打开门' },
  { src: 'Neural networks are powerful', tgt: '神经网络很强大' },
  { src: 'Machine learning models require large datasets', tgt: '机器学习模型需要大量数据' },
  { src: 'The weather is nice today', tgt: '今天天气很好' },
]

console.log('▶ 加载 LaBSE...')
const t0 = Date.now()
const extractor = await pipeline('feature-extraction', 'Xenova/LaBSE')
console.log(`  ✓ 加载完成 [${Date.now() - t0}ms]`)

const out = { model: 'Xenova/LaBSE', cases: [] }

for (const { src, tgt } of CASES) {
  console.log(`▶ 编码: ${src}  ⇆  ${tgt}`)
  // token-wise embedding：不 pooling，拿到每个 token 的向量
  // transformers.js 的 feature-extraction 默认会做 pooling
  // 要拿 token 级，用 { pooling: 'none' }
  const srcOut = await extractor(src, { pooling: 'none', normalize: false })
  const tgtOut = await extractor(tgt, { pooling: 'none', normalize: false })

  // srcOut 是 Tensor [1, seq_len, 768]
  const srcEmb = Array.from(srcOut.data)
  const tgtEmb = Array.from(tgtOut.data)
  const srcLen = srcOut.dims[1]
  const tgtLen = tgtOut.dims[1]
  const dim = srcOut.dims[2]

  // 重塑成 [seq_len, dim]
  const src2d = []
  for (let i = 0; i < srcLen; i++) {
    src2d.push(srcEmb.slice(i * dim, (i + 1) * dim))
  }
  const tgt2d = []
  for (let i = 0; i < tgtLen; i++) {
    tgt2d.push(tgtEmb.slice(i * dim, (i + 1) * dim))
  }

  out.cases.push({
    src, tgt,
    srcSeqLen: srcLen, tgtSeqLen: tgtLen, dim,
    srcEmb: src2d, tgtEmb: tgt2d,
  })
  console.log(`  src tokens=${srcLen}, tgt tokens=${tgtLen}, dim=${dim}`)
}

writeFileSync('test/fixtures/labse-embeddings.json', JSON.stringify(out))
console.log(`\n✓ 落 fixture: test/fixtures/labse-embeddings.json (${out.cases.length} cases)`)
