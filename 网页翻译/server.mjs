/**
 * 网页翻译 web 版 —— 不依赖扩展，直接打开浏览器就能用
 *
 * 用法：
 *   node server.mjs
 *   浏览器打开 http://localhost:8787
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translateBatches, BATCH_SIZE } from './lib/translate.mjs'
import { fetchUrl } from './lib/fetch-url.mjs'
import { callDeepL, mapLang } from './lib/deepl.mjs'
import { createLogger, genReqId } from './lib/logger.mjs'
import { readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── .env 自动加载（不依赖 dotenv，零依赖）─────────────────
// 已在 process.env 里的优先级最高，不覆盖
try {
  const envPath = path.resolve(__dirname, '.env')
  const txt = readFileSync(envPath, 'utf8')
  for (const line of txt.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    // 剥首尾引号
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* .env 不存在则忽略 */ }

const PORT = Number(process.env.PORT) || 8787
const log = createLogger('server')

// DeepL（W1-3 起作为主翻译后端，与扩展保持一致）
const DEEPL_KEY = process.env.DEEPL_API_KEY
if (!DEEPL_KEY) {
  log.warn('config.warn', { msg: 'DEEPL_API_KEY 未设置，/api/translate 将返回 500' })
}
log.info('config loaded', {
  deeplKeyMasked: DEEPL_KEY ? '***' + DEEPL_KEY.slice(-4) : '(unset)',
  endpoint: DEEPL_KEY?.endsWith(':fx') ? 'free' : 'pro',
  port: PORT,
})

// MiniMax 仅给"保结构翻译"路径用（占位符 prompt 需要 LLM 配合）
const MINIMAX_KEY = process.env.MINIMAX_API_KEY
const MINIMAX_API = process.env.MINIMAX_API || 'https://api.minimax.chat/v1/text/chatcompletion_v2'

/**
 * 保结构翻译 prompt —— 输入已含占位符 ⟦tN:tag⟧...⟦/tN⟧
 *
 * 对标 tech-plan §2.3：占位符约束让 LLM 不丢失 tag 位置
 */
const SYS_PROMPT_ALIGNED = `你是专业翻译引擎。输入文本中含特殊占位符（U+27E6 / U+27E7 包围）。

规则（最高优先级）：
1. 占位符 \`⟦tN⟧...⟦/tN⟧\` 必须原样保留，N 是数字，占位符是格式标记不可翻译
2. 占位符可以包裹不同的文字（语序调整时），但开闭配对不能错
3. 占位符内的文字要翻译，占位符本身（⟦tN⟧ 和 ⟦/tN⟧）不翻译、不修改
4. 专有名词、URL、代码、HTML 实体不翻译
5. 只输出译文文本（含占位符），不加任何解释、代码块、反引号

输出格式：纯文本，含占位符。`

/**
 * 保结构翻译：单段 srcHtml（含占位符）→ tgtText（含占位符）
 * prompt 强化占位符保留；不用 SEP 分块（每段独立调）
 */
async function callMinimaxAligned(srcHtml, tgtLang) {
  if (!MINIMAX_KEY) {
    const err = new Error('MINIMAX_API_KEY not configured')
    err.code = 'NO_MINIMAX_KEY'
    throw err
  }
  const userPrompt = `将以下占位符文本翻译成${tgtLang}：\n\n${srcHtml}`
  const r = await fetch(MINIMAX_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MINIMAX_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      stream: false,
      messages: [
        { role: 'system', content: SYS_PROMPT_ALIGNED },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    const err = new Error(`MiniMax ${r.status}: ${text.slice(0, 200)}`)
    err.status = r.status
    throw err
  }

  const data = await r.json()
  const full = data?.choices?.[0]?.message?.content ?? ''
  if (!full) throw new Error('MiniMax 返回空内容')
  return full.trim()
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ─── CORS ────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ─── 路由 ────────────────────────────────────────────
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = await readFile(path.join(__dirname, 'demo.html'), 'utf8')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }

  // 静态文件：lib/*.mjs （让浏览器 import ES modules）
  if (url.pathname.startsWith('/lib/') && url.pathname.endsWith('.mjs')) {
    try {
      const filePath = path.join(__dirname, url.pathname)
      const code = await readFile(filePath, 'utf8')
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
      res.end(code)
      return
    } catch {
      res.writeHead(404); res.end('not found'); return
    }
  }

  if (url.pathname === '/api/translate' && req.method === 'POST') {
    const reqId = genReqId()
    let body = ''
    for await (const c of req) body += c

    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      log.warn('translate.invalid_json', { reqId })
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid json' }))
      return
    }
    const { segments, tgtLang = '中文' } = payload

    if (!Array.isArray(segments) || segments.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'segments must be non-empty array' }))
      return
    }
    if (segments.length > 500) {
      // 防止恶意请求把服务打爆
      log.warn('translate.too_many_segments', { reqId, count: segments.length })
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `too many segments (max 500, got ${segments.length})` }))
      return
    }

    if (!DEEPL_KEY) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'DEEPL_API_KEY not configured' }))
      return
    }

    log.info('translate.start', { reqId, segCount: segments.length, batchSize: BATCH_SIZE, tgtLang, backend: 'deepl', target: mapLang(tgtLang) })
    const t0 = Date.now()
    try {
      // DeepL 单次最多 50 段；用 chunk 切批，每批独立调
      const DEEPL_BATCH = 50
      const batches = []
      for (let i = 0; i < segments.length; i += DEEPL_BATCH) {
        batches.push(segments.slice(i, i + DEEPL_BATCH))
      }
      const results = await Promise.allSettled(
        batches.map(b => callDeepL(b, tgtLang, DEEPL_KEY, { log }))
      )
      const merged = new Array(segments.length).fill('')
      let ok = 0, fail = 0
      let off = 0
      results.forEach((r, idx) => {
        const len = batches[idx].length
        if (r.status === 'fulfilled') {
          for (let i = 0; i < len; i++) {
            const v = r.value[i]
            if (v) { merged[off + i] = v; ok++ }
          }
          log.info('translate.batch_ok', { reqId, idx: idx + 1, total: batches.length, len })
        } else {
          fail += len
          log.warn('translate.batch_fail', { reqId, idx: idx + 1, total: batches.length, err: r.reason?.message })
        }
        off += len
      })
      const cost = Date.now() - t0
      log.info('translate.done', { reqId, segCount: segments.length, nonEmpty: ok, failed: fail, costMs: cost, ok: fail === 0 })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ translations: merged, batchSize: BATCH_SIZE }))
    } catch (e) {
      log.error('translate.failed', { reqId, costMs: Date.now() - t0, err: e.message, ok: false })
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ─── 保结构翻译（aligned pipeline）───────────────────
  if (url.pathname === '/api/translate-aligned' && req.method === 'POST') {
    const reqId = genReqId()
    let body = ''
    for await (const c of req) body += c
    let payload
    try { payload = JSON.parse(body) } catch {
      log.warn('aligned.invalid_json', { reqId })
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid json' }))
      return
    }
    const { srcHtml, tgtLang = '中文' } = payload
    if (!srcHtml || typeof srcHtml !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'srcHtml required' }))
      return
    }
    if (srcHtml.length > 5000) {
      log.warn('aligned.too_long', { reqId, len: srcHtml.length })
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'srcHtml too long (max 5000 chars)' }))
      return
    }
    log.info('aligned.start', { reqId, srcLen: srcHtml.length, tgtLang })
    const t0 = Date.now()
    try {
      const tgtText = await callMinimaxAligned(srcHtml, tgtLang)
      log.info('aligned.done', { reqId, srcLen: srcHtml.length, tgtLen: tgtText.length, costMs: Date.now() - t0, ok: true })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ tgtText }))
    } catch (e) {
      log.error('aligned.failed', { reqId, costMs: Date.now() - t0, err: e.message, ok: false })
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ─── /api/fetch 服务端 URL 代理（绕开浏览器 CORS）─────────
  if (url.pathname === '/api/fetch' && req.method === 'POST') {
    const reqId = genReqId()
    let body = ''
    for await (const c of req) body += c
    let payload
    try { payload = JSON.parse(body) } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid json' }))
      return
    }
    const target = payload.url
    if (!target || typeof target !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'url required' }))
      return
    }
    log.info('fetch.request', { reqId, url: target })
    const t0 = Date.now()
    try {
      const r = await fetchUrl(target, { log })
      log.info('fetch.ok', { reqId, url: target, status: r.status, bytes: r.bytes, costMs: Date.now() - t0 })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ url: r.url, html: r.html, contentType: r.contentType, status: r.status }))
    } catch (e) {
      log.warn('fetch.fail', { reqId, url: target, code: e.code, err: e.message, costMs: Date.now() - t0 })
      const status = /^HTTP_(\d+)$/.exec(e.code || '')?.[1] || 502
      res.writeHead(Number(status) >= 400 && Number(status) < 600 ? Number(status) : 502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, code: e.code }))
    }
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, () => {
  console.log(`\n🌐 网页翻译 demo 已启动`)
  console.log(`   浏览器打开 → http://localhost:${PORT}\n`)
})
