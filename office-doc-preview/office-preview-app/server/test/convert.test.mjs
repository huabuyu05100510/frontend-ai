// 格式转换 /api/convert 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import { upsertTask } from '../src/store.mjs'

let route
let server, baseUrl

beforeAll(async () => {
  const { CONFIG } = await import('../src/config.mjs')
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true })
  fs.mkdirSync(CONFIG.DERIVED_DIR, { recursive: true })
  await import('../src/store.mjs')
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

describe('POST /api/convert', () => {
  it('缺失 taskId 应返回 400', async () => {
    const r = await postJSON('/api/convert', { target: 'pdf' })
    expect(r.status).toBe(400)
    const d = await r.json()
    expect(d.error).toMatch(/taskId/)
  })

  it('非法 target 应返回 400', async () => {
    const r = await postJSON('/api/convert', { taskId: 't_test', target: 'docx' })
    expect(r.status).toBe(400)
  })

  it('不存在的 taskId 应返回 404', async () => {
    const r = await postJSON('/api/convert', { taskId: 'nonexistent_xyz' })
    expect(r.status).toBe(404)
  })

  it('已完成任务应返回 pdfUrl + pages 产物', async () => {
    const id = 't_conv_done_' + Date.now().toString(36)
    upsertTask({
      id, name: 'demo.docx', size: 12345, ext: 'docx',
      mime: 'application/vnd.openxmlformats', strategy: 'convert_pdf',
      originalUrl: `/api/files/${id}?as=original`,
      previewUrl: `/api/files/${id}?as=preview`,
      previewExt: 'pdf',
      convertStatus: 'done',
      pagesTotal: 2,
      pagesDone: 2,
      previewSize: 8888,
      convertDurationMs: 1234,
      pages: [
        { page: 1, url: `/api/files/${id}?as=page&n=1`, textUrl: `/api/files/${id}?as=text&n=1`, width: 800, height: 1130, bytes: 1000 },
        { page: 2, url: `/api/files/${id}?as=page&n=2`, textUrl: `/api/files/${id}?as=text&n=2`, width: 800, height: 1130, bytes: 1100 },
      ],
      status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
    })

    const r = await postJSON('/api/convert', { taskId: id })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.status).toBe('done')
    expect(d.target).toBe('pdf')
    expect(d.pdfUrl).toContain('/api/files/')
    expect(d.pages).toHaveLength(2)
    expect(d.pages[0]).toHaveProperty('url')
    expect(d.pages[0]).toHaveProperty('textUrl')
    expect(d.meta.pagesCount).toBe(2)
    expect(d.meta.engine).toBeTruthy()
    expect(r.headers.get('X-Convert-Status')).toBe('done')
    expect(r.headers.get('X-Convert-Pages')).toBe('2')
  })

  it('进行中任务应返回 progress 而非产物', async () => {
    const id = 't_conv_proc_' + Date.now().toString(36)
    upsertTask({
      id, name: 'big.pptx', size: 99999, ext: 'pptx',
      mime: 'application/vnd.openxmlformats', strategy: 'convert_pdf',
      originalUrl: `/api/files/${id}?as=original`,
      convertStatus: 'rasterizing',
      pagesTotal: 10,
      pagesDone: 3,
      convertStage: 'pages',
      status: 'processing', createdAt: Date.now(), updatedAt: Date.now(),
    })

    const r = await postJSON('/api/convert', { taskId: id, target: 'images' })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.status).toBe('rasterizing')
    expect(d.progress.pct).toBe(30)
    expect(d.pages).toBeUndefined()
    expect(r.headers.get('X-Convert-Status')).toBe('rasterizing')
  })

  it('失败任务应返回 error 信息', async () => {
    const id = 't_conv_fail_' + Date.now().toString(36)
    upsertTask({
      id, name: 'broken.docx', size: 100, ext: 'docx',
      mime: 'application/vnd.openxmlformats', strategy: 'convert_pdf',
      originalUrl: `/api/files/${id}?as=original`,
      convertStatus: 'failed',
      convertError: 'soffice timeout',
      status: 'failed', createdAt: Date.now(), updatedAt: Date.now(),
    })

    const r = await postJSON('/api/convert', { taskId: id })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.status).toBe('failed')
    expect(d.error).toMatch(/soffice/)
  })
})
