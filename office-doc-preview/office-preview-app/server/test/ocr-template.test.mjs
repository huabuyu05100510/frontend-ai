// OCR 模板 CRUD + 模板识别 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { CONFIG } from '../src/config.mjs'
import { upsertTask } from '../src/store.mjs'

let route
let server, baseUrl
let tplDir

beforeAll(async () => {
  tplDir = path.join(CONFIG.DERIVED_DIR, 'ocr-templates')
  fs.rmSync(tplDir, { recursive: true, force: true })
  fs.mkdirSync(tplDir, { recursive: true })
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
  fs.rmSync(tplDir, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(tplDir, { recursive: true, force: true })
  fs.mkdirSync(tplDir, { recursive: true })
})

async function postJSON(p, body) {
  return await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validTemplate = {
  name: '增值税专用发票',
  scenario: 'finance',
  sign: '92ba660faa1afc2adeb74c3d4b13cd31',
  fields: [
    { name: '发票号码', type: 'string', x: 200, y: 100, w: 360, h: 60 },
    { name: '开票日期', type: 'date', x: 220, y: 200, w: 280, h: 50 },
    { name: '价税合计', type: 'number', x: 180, y: 300, w: 400, h: 60 },
  ],
}

describe('POST /api/ocr/template', () => {
  it('200 创建模板', async () => {
    const r = await postJSON('/api/ocr/template', validTemplate)
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.id).toBeTruthy()
    expect(d.template.name).toBe('增值税专用发票')
    expect(d.template.fields.length).toBe(3)
    expect(d.template.scenario).toBe('finance')
  })

  it('400 缺少 name', async () => {
    const bad = { ...validTemplate }
    delete bad.name
    const r = await postJSON('/api/ocr/template', bad)
    expect(r.status).toBe(400)
  })

  it('400 字段缺少坐标', async () => {
    const r = await postJSON('/api/ocr/template', {
      ...validTemplate,
      fields: [{ name: 'X', type: 'string' }],
    })
    expect(r.status).toBe(400)
  })

  it('支持医疗/通用/证照场景', async () => {
    for (const scenario of ['medical', 'general', 'id-card']) {
      const r = await postJSON('/api/ocr/template', { ...validTemplate, scenario, name: `tpl-${scenario}` })
      expect(r.status).toBe(200)
      expect((await r.json()).template.scenario).toBe(scenario)
    }
  })
})

describe('GET /api/ocr/templates', () => {
  it('返回全部模板', async () => {
    await postJSON('/api/ocr/template', { ...validTemplate, name: 'T1', sign: 'sig1' })
    await postJSON('/api/ocr/template', { ...validTemplate, name: 'T2', sign: 'sig2' })

    const r = await fetch(baseUrl + '/api/ocr/templates')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.items.length).toBe(2)
    expect(r.headers.get('x-template-count')).toBe('2')
  })

  it('按 scenario 过滤', async () => {
    await postJSON('/api/ocr/template', { ...validTemplate, name: 'T1', scenario: 'finance' })
    await postJSON('/api/ocr/template', { ...validTemplate, name: 'T2', scenario: 'medical' })

    const r = await fetch(baseUrl + '/api/ocr/templates?scenario=medical')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.items.length).toBe(1)
    expect(d.items[0].scenario).toBe('medical')
  })
})

describe('DELETE /api/ocr/template/:id', () => {
  it('按 id 删除', async () => {
    const cr = await postJSON('/api/ocr/template', validTemplate)
    const id = (await cr.json()).id

    const r = await fetch(baseUrl + `/api/ocr/template/${id}`, { method: 'DELETE' })
    expect(r.status).toBe(200)

    const lr = await fetch(baseUrl + '/api/ocr/templates')
    const ld = await lr.json()
    expect(ld.items.length).toBe(0)
  })

  it('不存在的 id 404', async () => {
    const r = await fetch(baseUrl + '/api/ocr/template/nonexistent', { method: 'DELETE' })
    expect(r.status).toBe(404)
  })
})

describe('POST /api/ocr/recognize-template', () => {
  it('400 缺少 templateId', async () => {
    const r = await postJSON('/api/ocr/recognize-template', { taskId: 't1' })
    expect(r.status).toBe(400)
  })

  it('404 模板不存在', async () => {
    const r = await postJSON('/api/ocr/recognize-template', { taskId: 't1', templateId: 'nonexistent' })
    expect(r.status).toBe(404)
  })

  it('200 mock 模式返回结构化字段', async () => {
    // 准备 task
    upsertTask({
      id: 't_ocr_test',
      name: 'invoice.png',
      ext: 'png',
      originalPath: '/tmp/nonexistent.png',
      status: 'ready',
    })

    // 创建模板
    const tr = await postJSON('/api/ocr/template', validTemplate)
    const templateId = (await tr.json()).id

    const r = await postJSON('/api/ocr/recognize-template', {
      taskId: 't_ocr_test',
      templateId,
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.engine).toBeTruthy()
    expect(Array.isArray(d.fields)).toBe(true)
    expect(d.fields.length).toBe(3)
    // 每个字段含 name + value
    for (const f of d.fields) {
      expect(f.name).toBeTruthy()
      expect(typeof f.value).toBe('string')
    }
    // mock 引擎标识
    expect(r.headers.get('x-ocr-engine')).toContain('mock')
  })
})
