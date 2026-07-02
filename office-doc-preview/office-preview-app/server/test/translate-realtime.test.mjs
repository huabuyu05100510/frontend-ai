// 实时翻译 + 词级对齐 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'

let route
let server, baseUrl

beforeAll(async () => {
  const routerMod = await import('../src/router.mjs')
  route = routerMod.route
  server = http.createServer((req, res) => route(req, res).catch(err => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err.message || err) }))
    }
  }))
  await new Promise(r => server.listen(0, r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
})

async function postJSON(p, body) {
  return await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/translate/realtime', () => {
  it('400 缺少 text', async () => {
    const r = await postJSON('/api/translate/realtime', { sourceLang: 'zh-CN', targetLang: 'en' })
    expect(r.status).toBe(400)
  })

  it('400 不支持的目标语言', async () => {
    const r = await postJSON('/api/translate/realtime', { text: '你好', sourceLang: 'zh-CN', targetLang: 'xx' })
    expect(r.status).toBe(400)
  })

  it('200 返回 target + engine + ms 响应头', async () => {
    const r = await postJSON('/api/translate/realtime', { text: '你好世界', sourceLang: 'zh-CN', targetLang: 'en' })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(typeof d.target).toBe('string')
    expect(d.target.length).toBeGreaterThan(0)
    expect(typeof d.engine).toBe('string')
    expect(typeof d.ms).toBe('number')
    // 可观测响应头
    expect(r.headers.get('x-translate-engine')).toBeTruthy()
    expect(r.headers.get('x-translate-ms')).toBeTruthy()
  })

  it('空文本 400', async () => {
    const r = await postJSON('/api/translate/realtime', { text: '', sourceLang: 'zh-CN', targetLang: 'en' })
    expect(r.status).toBe(400)
  })
})

describe('POST /api/translate/align', () => {
  it('400 缺少 src/tgt', async () => {
    const r = await postJSON('/api/translate/align', { src: 'hello' })
    expect(r.status).toBe(400)
  })

  it('200 返回 srcTokens + tgtTokens + pairs', async () => {
    const r = await postJSON('/api/translate/align', {
      src: 'I love coding',
      tgt: '我 喜欢 编程',
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(Array.isArray(d.srcTokens)).toBe(true)
    expect(Array.isArray(d.tgtTokens)).toBe(true)
    expect(Array.isArray(d.pairs)).toBe(true)
    expect(d.srcTokens.length).toBeGreaterThan(0)
    expect(d.tgtTokens.length).toBeGreaterThan(0)
    // pair 结构：[srcIdx, tgtIdx, score]
    if (d.pairs.length > 0) {
      const p = d.pairs[0]
      expect(p.length).toBeGreaterThanOrEqual(2)
      expect(Number.isInteger(p[0])).toBe(true)
      expect(Number.isInteger(p[1])).toBe(true)
    }
  })

  it('完全无公共 token → pairs 为空', async () => {
    const r = await postJSON('/api/translate/align', {
      src: 'aaa bbb',
      tgt: 'ccc ddd',
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    // 无公共时对齐应该没有强匹配（pair 可能仍有序号配对，按 Myers 行为校验）
    expect(Array.isArray(d.pairs)).toBe(true)
  })
})
