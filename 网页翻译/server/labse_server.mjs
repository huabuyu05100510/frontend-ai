/**
 * LaBSE 词级对齐服务（W1-5）
 *
 * 端口 8788
 * 端点：
 *   POST /align  { src, tgt, strategy? } → { srcTokens, tgtTokens, alignments, took }
 *   GET  /health                          → { ok, model, ready }
 *
 * 模型：Xenova/LaBSE (hf-mirror 镜像，~500MB ONNX)
 * 算法：lib/labse-simalign.mjs（Route A，F1=0.841 on gold）
 *
 * 启动：
 *   node server/labse_server.mjs
 *
 * 模型：Claude (Sonnet 4.5)
 */
import http from 'node:http'
import { pipeline, env, AutoTokenizer } from '@huggingface/transformers'
import { buildSimMatrix, simAlign } from '../lib/labse-simalign.mjs'

env.remoteHost = 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'

const PORT = Number(process.env.LABSE_PORT ?? 8788)
const MODEL = 'Xenova/LaBSE'

const log = (level, msg, fields = {}) => {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, component: 'xt:labse', msg, ...fields }))
  } catch {}
}

// ─── 模型懒加载（首次 /align 调用时拉起，避免冷启动占内存）──────────
let _extractor = null
let _tokenizer = null
let _loading = null

async function loadModel() {
  if (_extractor && _tokenizer) return { extractor: _extractor, tokenizer: _tokenizer }
  if (_loading) return _loading
  _loading = (async () => {
    const t0 = Date.now()
    log('info', 'loading LaBSE', { model: MODEL })
    _extractor = await pipeline('feature-extraction', MODEL)
    _tokenizer = await AutoTokenizer.from_pretrained(MODEL)
    const dt = Date.now() - t0
    log('info', 'LaBSE ready', { tookMs: dt })
    return { extractor: _extractor, tokenizer: _tokenizer }
  })()
  return _loading
}

// 启动后后台预热（不阻塞 server.listen）
loadModel().catch(e => log('error', 'warmup failed', { err: String(e) }))

// ─── token 文本提取（id → 可读文本）──────────────────────────────
function decodeTokenIds(tokenizer, ids) {
  // LaBSE 用 SentencePiece，单 id decode 出来带 ▁ 前缀；保留原 token 文本
  return ids.map(id => {
    const t = tokenizer.decode([id])
    return t.replace(/^▁/, ' ').trim() || `[${id}]`
  })
}

// ─── 对齐核心 ─────────────────────────────────────────────────
/**
 * @param {string} src
 * @param {string} tgt
 * @param {'argmax'|'union'|'intersect'|'grow_diag'} strategy
 */
async function alignPair(src, tgt, strategy = 'argmax') {
  const { extractor, tokenizer } = await loadModel()

  // 1. 提取 token-level embedding（pooling=none）
  const srcOut = await extractor(src, { pooling: 'none', normalize: false })
  const tgtOut = await extractor(tgt, { pooling: 'none', normalize: false })

  // [1, seq_len, dim] → [seq_len, dim]，并去掉 [CLS]/[SEP]
  const srcLen = srcOut.dims[1]
  const tgtLen = tgtOut.dims[1]
  const dim = srcOut.dims[2]

  const src2d = []
  for (let i = 1; i < srcLen - 1; i++) {
    src2d.push(Array.from(srcOut.data.subarray(i * dim, (i + 1) * dim)))
  }
  const tgt2d = []
  for (let i = 1; i < tgtLen - 1; i++) {
    tgt2d.push(Array.from(tgtOut.data.subarray(i * dim, (i + 1) * dim)))
  }

  // 2. 拿 token 文本（用于 UI 显示）
  const srcIds = Array.from(tokenizer(src).input_ids.data, x => Number(x))
  const tgtIds = Array.from(tokenizer(tgt).input_ids.data, x => Number(x))
  // 去掉 [CLS] / [SEP]
  const srcTokenTexts = decodeTokenIds(tokenizer, srcIds.slice(1, -1))
  const tgtTokenTexts = decodeTokenIds(tokenizer, tgtIds.slice(1, -1))

  // 3. SimAlign
  const sim = buildSimMatrix(src2d, tgt2d)
  const alignments = simAlign(sim, { strategy }).map(a => ({
    srcIdx: a.srcIdx,
    tgtIdx: a.tgtIdx,
    score: Number(a.score.toFixed(4)),
  }))

  return {
    srcTokens: srcTokenTexts,
    tgtTokens: tgtTokenTexts,
    alignments,
  }
}

// ─── HTTP server ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, model: MODEL, ready: !!_extractor, port: PORT }))
    return
  }

  if (req.method === 'POST' && req.url === '/align') {
    const t0 = Date.now()
    let body = ''
    for await (const chunk of req) body += chunk
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON' }))
      return
    }
    const { src, tgt, strategy } = payload
    if (typeof src !== 'string' || typeof tgt !== 'string' || !src || !tgt) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'src and tgt must be non-empty strings' }))
      return
    }

    try {
      const result = await alignPair(src, tgt, strategy)
      const took = Date.now() - t0
      log('info', 'align ok', { srcLen: src.length, tgtLen: tgt.length, tookMs: took, pairs: result.alignments.length })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ...result, took }))
    } catch (e) {
      log('error', 'align failed', { err: String(e), stack: e.stack })
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, '127.0.0.1', () => {
  log('info', 'LaBSE alignment server listening', { port: PORT, model: MODEL })
})
