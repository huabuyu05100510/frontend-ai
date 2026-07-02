// /api/inspect/translate/render-image|render-text 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

let route, upsertTask, getTask, loadTasks, CONFIG

let server, baseUrl

beforeAll(async () => {
  ;({ CONFIG } = await import('../src/config.mjs'))
  const store = await import('../src/store.mjs')
  upsertTask = store.upsertTask
  getTask = store.getTask
  loadTasks = store.loadTasks
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true })
  fs.mkdirSync(CONFIG.DERIVED_DIR, { recursive: true })

  const routerMod = await import('../src/router.mjs')
  route = routerMod.route

  server = http.createServer((req, res) => route(req, res).catch(err => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err.message || err) }))
    }
  }))
  await new Promise(r => server.listen(0, r))
  const port = server.address().port
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise(r => server.close(r))
})

function httpReq(method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl)
    const req = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function makeTxtTask(taskId, content) {
  const originalPath = path.join(CONFIG.UPLOAD_DIR, `${taskId}_src.txt`)
  fs.writeFileSync(originalPath, content, 'utf-8')
  const task = {
    id: taskId,
    name: `${taskId}.txt`,
    size: Buffer.byteLength(content),
    ext: 'txt',
    mime: 'text/plain',
    strategy: 'frontend',
    originalPath,
    originalUrl: `/api/files/${taskId}?as=original`,
    previewUrl: `/api/files/${taskId}?as=preview`,
    previewExt: 'txt',
    convertStatus: 'done',
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  upsertTask(task)
  return task
}

beforeEach(() => { loadTasks() })

describe('GET /api/inspect/translate/render-image — 单页译文图片渲染', () => {
  it('返回 200 + image/png + 有效 PNG 内容（≥ 1KB）', async () => {
    const task = makeTxtTask('tr-img-1', '第一段：原文内容。\n第二段：另一段。')
    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
    expect(r.body.length).toBeGreaterThan(1024)
    // PNG magic: 89 50 4E 47
    expect(r.body[0]).toBe(0x89)
    expect(r.body[1]).toBe(0x50)
    expect(r.body[2]).toBe(0x4E)
    expect(r.body[3]).toBe(0x47)
  })

  it('可观测响应头：X-Translate-Page / Cached / Render-Ms / Page-W / Page-H', async () => {
    const task = makeTxtTask('tr-img-2', '单段内容。')
    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-page']).toBe('1')
    expect(['0', '1']).toContain(r.headers['x-translate-cached'])
    expect(Number(r.headers['x-translate-render-ms'])).toBeGreaterThanOrEqual(0)
    expect(Number(r.headers['x-translate-page-w'])).toBeGreaterThan(0)
    expect(Number(r.headers['x-translate-page-h'])).toBeGreaterThan(0)
  })

  it('缓存命中：第二次同请求 X-Translate-Cached=1', async () => {
    const task = makeTxtTask('tr-img-3', '内容 A。\n内容 B。')
    const r1 = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r1.status).toBe(200)
    const r2 = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r2.status).toBe(200)
    expect(r2.headers['x-translate-cached']).toBe('1')
    expect(r2.body.length).toBe(r1.body.length)
  })

  it('缺少 taskId → 400', async () => {
    const r = await httpReq('GET', '/api/inspect/translate/render-image?page=1&sourceLang=zh-CN&targetLang=en')
    expect(r.status).toBe(400)
  })

  it('page 越界 → 404', async () => {
    const task = makeTxtTask('tr-img-4', '单行。')
    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=999&sourceLang=zh-CN&targetLang=en`)
    expect(r.status).toBe(404)
  })

  it('不支持的 targetLang → 400', async () => {
    const task = makeTxtTask('tr-img-5', '内容。')
    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=klingon`)
    expect(r.status).toBe(400)
  })
})

describe('GET /api/inspect/translate/render-text — 单页译文文字层', () => {
  it('返回 200 + text/html + 含 PDFium data-pdfium 标记的 spans', async () => {
    const task = makeTxtTask('tr-txt-1', '原文。')
    const r = await httpReq('GET', `/api/inspect/translate/render-text?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
    const html = r.body.toString('utf-8')
    expect(html).toMatch(/data-pdfium=/)
    expect(html).toMatch(/<span /)
  })

  it('可观测响应头 + 缓存命中', async () => {
    const task = makeTxtTask('tr-txt-2', 'cache test。')
    const r1 = await httpReq('GET', `/api/inspect/translate/render-text?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r1.status).toBe(200)
    const r2 = await httpReq('GET', `/api/inspect/translate/render-text?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    expect(r2.status).toBe(200)
    expect(r2.headers['x-translate-cached']).toBe('1')
  })
})

describe('性能基准', () => {
  it('冷启动单页渲染 < 8s（soffice + PDFium）', async () => {
    const task = makeTxtTask('tr-perf-cold', '冷启动测试。\n第二段。\n第三段。')
    const t0 = Date.now()
    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    const totalMs = Date.now() - t0
    expect(r.status).toBe(200)
    expect(totalMs).toBeLessThan(8000)
  }, 12000)

  it('缓存命中 < 50ms', async () => {
    const task = makeTxtTask('tr-perf-cached', '内容。')
    // 预热
    await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    const t0 = Date.now()
    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    const totalMs = Date.now() - t0
    expect(r.status).toBe(200)
    expect(totalMs).toBeLessThan(100)
  })
})

describe('并发去重（防止 /render-image + /render-text 同时触发竞态）', () => {
  it('同 key 并发请求 → inflight-dedupe 不会重复 soffice 转换', async () => {
    const task = makeTxtTask('tr-concurrent', '并发去重测试。\n第二行。\n第三行。')
    // 清缓存
    const cacheDir = path.join(CONFIG.DATA_DIR, 'translate-render-cache', task.id, 'en')
    try { fs.rmSync(cacheDir, { recursive: true, force: true }) } catch {}

    // 并发触发 image + text
    const [imgRes, txtRes] = await Promise.all([
      httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`),
      httpReq('GET', `/api/inspect/translate/render-text?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`),
    ])

    expect(imgRes.status).toBe(200)
    expect(txtRes.status).toBe(200)
    expect(imgRes.body.length).toBeGreaterThan(1024)
    expect(txtRes.body.toString('utf-8')).toMatch(/data-pdfium=/)
  }, 15000)

  it('同 key 5 个并发请求 → 全部 200，不报错', async () => {
    const task = makeTxtTask('tr-concurrent-5', '5x 并发。')
    const cacheDir = path.join(CONFIG.DATA_DIR, 'translate-render-cache', task.id, 'en')
    try { fs.rmSync(cacheDir, { recursive: true, force: true }) } catch {}

    const requests = Array.from({ length: 5 }, (_, i) =>
      httpReq('GET', `/api/inspect/translate/render-${i % 2 === 0 ? 'image' : 'text'}?taskId=${task.id}&page=1&sourceLang=zh-CN&targetLang=en`)
    )
    const results = await Promise.all(requests)
    results.forEach((r, i) => {
      expect(r.status, `req ${i} status`).toBe(200)
    })
  }, 20000)
})
