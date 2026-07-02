/**
 * e2e：起一个本地 mock MiniMax 服务，再起 server.mjs（指向 mock），
 *      POST 多段验证不截断、并行、容错
 *
 * 启动：node --test test/server.e2e.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MOCK_PORT = 18797  // mock MiniMax 端口
const SERVER_PORT = 18787  // 真服务端口

let mockCalls = []
let failBatches = new Set()
let mockServer = null
let serverProc = null

// ─── mock MiniMax ───────────────────────────────────────
function startMockMinimax() {
  return new Promise(resolve => {
    mockServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        try {
          const { messages } = JSON.parse(body)
          const segs = messages[1].content.split('<SEP>').length
          mockCalls.push({ segs })
          if (failBatches.has(mockCalls.length)) {
            res.writeHead(502, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'mock fail' }))
            return
          }
          const parts = Array.from({ length: segs }, (_, i) => `译${i}`)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { content: parts.join('\n<SEP>\n') } }],
          }))
        } catch (e) {
          res.writeHead(400).end(String(e))
        }
      })
    })
    mockServer.listen(MOCK_PORT, () => resolve())
  })
}

// ─── 起 server.mjs ──────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, ['server.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        MINIMAX_API: `http://localhost:${MOCK_PORT}/v1/text/chatcompletion_v2`,
        MINIMAX_KEY: 'mock-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    serverProc.stdout.on('data', d => { out += d.toString() })
    serverProc.stderr.on('data', d => { out += d.toString() })
    const onData = chunk => {
      out += chunk.toString()
      if (out.includes('已启动')) {
        serverProc.stdout.off('data', onData)
        resolve()
      }
    }
    serverProc.stdout.on('data', onData)
    setTimeout(() => reject(new Error('server start timeout\n' + out)), 5000)
  })
}

test.before(async () => {
  await startMockMinimax()
  await startServer()
  // server.listen 回调里打日志，多给 100ms 让 accept 循环就绪
  await new Promise(r => setTimeout(r, 100))
})

test.after(async () => {
  if (serverProc) {
    await new Promise(r => {
      serverProc.once('exit', () => r())
      serverProc.kill('SIGTERM')
      setTimeout(r, 1000)
    })
  }
  if (mockServer) await new Promise(r => mockServer.close(() => r()))
})

function resetMocks({ fail = new Set() } = {}) {
  mockCalls = []
  failBatches = fail
}

// ─── 测试 ───────────────────────────────────────────────
test('e2e: 30 段应全部翻译返回（bug 修复验证）', async () => {
  resetMocks()
  const segments = Array.from({ length: 30 }, (_, i) => `<p>hello ${i}</p>`)
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments, tgtLang: '中文' }),
  })

  assert.equal(r.status, 200, `期望 200，实际 ${r.status}`)
  const data = await r.json()
  assert.equal(data.translations.length, 30, `期望 30 段，实际 ${data.translations.length} —— 这就是 bug`)
  assert.equal(data.translations[0], '译0')
  assert.equal(data.translations[19], '译19')
  // 第 2 批 mock 索引重置为 0..9
  assert.equal(data.translations[20], '译0')
  assert.equal(data.translations[29], '译9')
  // 30 → 2 批 (20 + 10)
  assert.equal(mockCalls.length, 2, `期望 2 次 mock 调用，实际 ${mockCalls.length}`)
  assert.deepEqual(mockCalls.map(c => c.segs), [20, 10])
})

test('e2e: 50 段 → 3 批 (20+20+10)，顺序保留', async () => {
  resetMocks()
  const segments = Array.from({ length: 50 }, (_, i) => `seg${i}`)
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments }),
  })
  assert.equal(r.status, 200)
  const data = await r.json()
  assert.equal(data.translations.length, 50)
  assert.equal(data.translations[0], '译0')
  assert.equal(data.translations[19], '译19')
  assert.equal(data.translations[20], '译0')
  assert.equal(data.translations[49], '译9')
  assert.equal(mockCalls.length, 3)
  assert.deepEqual(mockCalls.map(c => c.segs), [20, 20, 10])
})

test('e2e: 空数组 → 400', async () => {
  resetMocks()
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments: [], tgtLang: '中文' }),
  })
  assert.equal(r.status, 400)
})

test('e2e: >500 段 → 413', async () => {
  resetMocks()
  const segments = Array.from({ length: 501 }, (_, i) => `s${i}`)
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments }),
  })
  assert.equal(r.status, 413)
})

test('e2e: 第 2 批 502 → 仍返 30 段，失败位置填空', async () => {
  resetMocks({ fail: new Set([2]) })
  const segments = Array.from({ length: 30 }, (_, i) => `<p>hello ${i}</p>`)
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments }),
  })
  assert.equal(r.status, 200)
  const data = await r.json()
  assert.equal(data.translations.length, 30)
  assert.equal(data.translations[0], '译0')
  assert.equal(data.translations[19], '译19')
  assert.equal(data.translations[20], '')
  assert.equal(data.translations[29], '')
})

test('e2e: OPTIONS 预检 → 204', async () => {
  resetMocks()
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, { method: 'OPTIONS' })
  assert.equal(r.status, 204)
})

test('e2e: 非法 JSON → 400', async () => {
  resetMocks()
  const r = await fetch(`http://localhost:${SERVER_PORT}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
  })
  assert.equal(r.status, 400)
})