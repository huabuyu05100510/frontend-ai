// server/test/word-diff-endpoint.test.mjs
// 模型：claude-sonnet-4-6
// Phase A.1: 端点集成测试（通过 route() 顶层入口）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { route } from '../src/router.mjs'

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      route(req, res)
    })
    server.listen(0, () => resolve(server))
  })
}

function post(server, path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    }, (res) => {
      let chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) }) }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: text }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('POST /api/inspect/translate/word-diff', () => {
  let server
  beforeAll(async () => { server = await startServer() })
  afterAll(async () => { await new Promise((r) => server.close(r)) })

  it('正常请求：返回 srcTokens/tgtTokens/ops/offsets', async () => {
    const r = await post(server, '/api/inspect/translate/word-diff', {
      taskId: 't_x', segmentId: 'seg:p1s0',
      source: '前端工程师负责 React 开发', target: 'Frontend engineer handles React development',
      langPair: ['zh', 'en'],
    })
    expect(r.status).toBe(200)
    expect(r.body.srcTokens.length).toBeGreaterThan(0)
    expect(r.body.tgtTokens.length).toBeGreaterThan(0)
    expect(r.body.ops.length).toBeGreaterThan(0)
    expect(r.body.srcOffsets.length).toBe(r.body.srcTokens.length)
    expect(r.body.tgtOffsets.length).toBe(r.body.tgtTokens.length)
    // 响应头
    expect(r.headers['x-translate-worddiff-src-tokens']).toBeDefined()
    expect(r.headers['x-translate-worddiff-tgt-tokens']).toBeDefined()
    expect(r.headers['x-translate-worddiff-ops']).toBeDefined()
    expect(r.headers['x-translate-worddiff-ms']).toBeDefined()
    expect(r.headers['x-translate-worddiff-lang-pair']).toBe('zh-en')
    expect(r.headers['x-translate-worddiff-task-id']).toBe('t_x')
    expect(r.headers['x-translate-worddiff-segment-id']).toBe('seg:p1s0')
  })

  it('缺少 source → 400', async () => {
    const r = await post(server, '/api/inspect/translate/word-diff', { target: 'hello' })
    expect(r.status).toBe(400)
  })

  it('缺少 target → 400', async () => {
    const r = await post(server, '/api/inspect/translate/word-diff', { source: 'hello' })
    expect(r.status).toBe(400)
  })

  it('空字符串：返回空 tokens 与空 ops', async () => {
    const r = await post(server, '/api/inspect/translate/word-diff', { source: '', target: '' })
    expect(r.status).toBe(200)
    expect(r.body.srcTokens).toEqual([])
    expect(r.body.tgtTokens).toEqual([])
    expect(r.body.ops).toEqual([])
  })
})
