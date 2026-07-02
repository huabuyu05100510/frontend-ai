// 静态 SPA 路由测试 — 验证 web/dist/ 被正确服务（v4.2）
// 模型：claude-sonnet-4-6
//
// 用例：
//   1. GET /          → 200 + index.html
//   2. GET /index.html → 200 + html
//   3. GET /assets/<any-hashed-file>  → 200 + 真实文件
//   4. GET /some/spa/route → 200 + index.html（SPA fallback）
//   5. GET /api/health → 仍然返回 JSON（API 不受影响）
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

let route
let server, baseUrl
let distDir

function httpReq(method, urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl)
    const req = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search
    }, (res) => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }))
    })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  // 准备临时 web/dist/（包含 index.html + 1 个 asset）
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-dist-'))
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body id="root">SPA</body></html>')
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(distDir, 'assets', 'app.test-ABC.js'), 'console.log("hello")')

  // 让 router 找我们的临时目录（通过覆盖 process.env.WEB_DIST_DIR 读取）
  process.env.WEB_DIST_DIR_OVERRIDE = distDir
  const { CONFIG } = await import('../src/config.mjs')

  // 重新 import config 后再 import router（同一个模块缓存）
  const routerMod = await import('../src/router.mjs')
  route = routerMod.route

  server = http.createServer((req, res) => route(req, res).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err.message || err) }))
  }))
  await new Promise(r => server.listen(0, r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise(r => server.close(r))
  fs.rmSync(distDir, { recursive: true, force: true })
})

describe('v4.2 — 静态 SPA 路由（web/dist/）', () => {
  it('GET / 返回 index.html (200)', async () => {
    const r = await httpReq('GET', '/')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/text\/html/)
    expect(r.body).toContain('<body id="root">')
  })

  it('GET /index.html 返回真实文件', async () => {
    const r = await httpReq('GET', '/index.html')
    expect(r.status).toBe(200)
    expect(r.body).toContain('SPA')
  })

  it('GET /assets/app.test-ABC.js 返回真实静态资源 (immutable cache)', async () => {
    const r = await httpReq('GET', '/assets/app.test-ABC.js')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/javascript/)
    expect(r.body).toContain('console.log')
    expect(r.headers['cache-control']).toMatch(/immutable/)
  })

  it('GET /unknown/spa/path → SPA fallback (index.html, 200)', async () => {
    const r = await httpReq('GET', '/some/deep/route')
    expect(r.status).toBe(200)
    expect(r.body).toContain('<body id="root">')
  })

  it('GET /api/health 不被静态路由接管（仍返回 JSON）', async () => {
    const r = await httpReq('GET', '/api/health')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/application\/json/)
    expect(JSON.parse(r.body).ok).toBe(true)
  })
})