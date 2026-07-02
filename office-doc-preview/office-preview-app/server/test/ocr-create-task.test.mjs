// OCR 识别 → 可搜索 PDF 新文件 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { upsertTask, getTask } from '../src/store.mjs'
import { CONFIG } from '../src/config.mjs'

let server, baseUrl
let route

// mock 多部分 + OCR（避免拉真实依赖）
vi.mock('../src/ocr.mjs', async () => {
  return {
    ocrImage: vi.fn(async () => ({
      engine: 'mock', ms: 1,
      text: 'Hello World',
      regions: [
        { text: 'Hello', x: 100, y: 100, width: 100, height: 30, confidence: 0.95 },
        { text: 'World', x: 220, y: 100, width: 80, height: 30, confidence: 0.42 },
      ],
      imageSize: { width: 800, height: 600 },
    })),
    detectTextRegions: vi.fn(),
    compareOCRResults: vi.fn(),
  }
})

beforeAll(async () => {
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

function makePngTask() {
  const id = 't_ocr_src_' + Date.now().toString(36)
  const name = 'invoice.png'
  const filePath = path.join(CONFIG.UPLOAD_DIR, id + '_' + name)
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  upsertTask({
    id, name, size: 1024, ext: 'png', mime: 'image/png', strategy: 'frontend',
    originalUrl: `/api/files/${id}?as=original`,
    previewUrl: `/api/files/${id}?as=original`,
    previewExt: 'png',
    originalPath: filePath,
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
  })
  return { id, filePath }
}

describe('POST /api/ocr/create-task — OCR 导出可搜索 PDF', () => {
  it('OCR + 生成 PDF + 创建新 task，返回 taskId + originalUrl', async () => {
    const { id: srcId } = makePngTask()
    const r = await postJSON('/api/ocr/create-task', { taskId: srcId })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.taskId).toBeTruthy()
    expect(d.taskId).not.toBe(srcId)  // 新任务
    expect(d.originalUrl).toContain('/api/files/')
    expect(d.originalUrl).toContain('?as=original')
    expect(d.size).toBeGreaterThan(200)
    expect(d.textRegions).toBe(2)
    expect(d.engine).toBe('mock')

    // headers
    expect(r.headers.get('x-ocr-pdf-engine')).toBeTruthy()
    expect(r.headers.get('x-ocr-ms')).toBeTruthy()

    // 检查新任务的实际文件
    const t = getTask(d.taskId)
    expect(t).toBeTruthy()
    expect(fs.existsSync(t.originalPath)).toBe(true)
    expect(t.ext).toBe('pdf')
    const buf = fs.readFileSync(t.originalPath)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // 清理
    fs.unlinkSync(t.originalPath)
  })

  it('task 不存在 → 404', async () => {
    const r = await postJSON('/api/ocr/create-task', { taskId: 't_does_not_exist_xyz' })
    expect(r.status).toBe(404)
    const d = await r.json()
    expect(d.error).toContain('task not found')
  })

  it('原文件丢失 → 404', async () => {
    const { id, filePath } = makePngTask()
    fs.unlinkSync(filePath)
    const r = await postJSON('/api/ocr/create-task', { taskId: id })
    expect(r.status).toBe(404)
    const d = await r.json()
    expect(d.error).toBeTruthy()
  })

  it('taskId 缺失 → 400', async () => {
    const r = await postJSON('/api/ocr/create-task', {})
    expect(r.status).toBe(400)
  })

  it('生成的 PDF 包含 OCR 文字层（pdftotext 可见）', async () => {
    const { id: srcId } = makePngTask()
    const r = await postJSON('/api/ocr/create-task', { taskId: srcId })
    const d = await r.json()
    const t = getTask(d.taskId)
    // 不调外部命令 — 只验证 PDF 是合法 PDF + 包含 'Hello' 或 'World'
    const buf = fs.readFileSync(t.originalPath)
    const s = buf.toString('latin1')
    expect(s).toContain('Hello')
    expect(s).toContain('World')
    fs.unlinkSync(t.originalPath)
  })
})
