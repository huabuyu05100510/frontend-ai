// 翻译标注反馈 CRUD 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { CONFIG } from '../src/config.mjs'

let route
let server, baseUrl
let annDir

beforeAll(async () => {
  annDir = path.join(CONFIG.DERIVED_DIR, 'translate-annotations')
  fs.rmSync(annDir, { recursive: true, force: true })
  fs.mkdirSync(annDir, { recursive: true })
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
  fs.rmSync(annDir, { recursive: true, force: true })
})

beforeEach(() => {
  // 清空 jsonl 文件
  for (const f of fs.readdirSync(annDir)) {
    if (f.endsWith('.jsonl')) fs.unlinkSync(path.join(annDir, f))
  }
})

async function postJSON(p, body) {
  return await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validInput = {
  kind: 'seg_rating',
  taskId: 'task-xyz',
  segmentId: 'seg-0',
  srcText: 'I love coding',
  tgtText: '我 喜欢 编程',
  langPair: ['en', 'zh'],
  payload: { rating: 5, comment: '翻译准确' },
}

describe('POST /api/translate/annotation', () => {
  it('200 创建 seg_rating 标注', async () => {
    const r = await postJSON('/api/translate/annotation', validInput)
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.ok).toBe(true)
    expect(d.id).toBeTruthy()
    expect(d.annotation.kind).toBe('seg_rating')
    expect(d.annotation.payload.rating).toBe(5)
    expect(r.headers.get('x-annotation-id')).toBe(d.id)
    expect(r.headers.get('x-annotation-kind')).toBe('seg_rating')
  })

  it('400 缺少 kind', async () => {
    const bad = { ...validInput }
    delete bad.kind
    const r = await postJSON('/api/translate/annotation', bad)
    expect(r.status).toBe(400)
  })

  it('400 非法 langPair', async () => {
    const r = await postJSON('/api/translate/annotation', { ...validInput, langPair: ['xx', 'yy'] })
    expect(r.status).toBe(400)
  })

  it('支持 alt_trans 类型', async () => {
    const r = await postJSON('/api/translate/annotation', {
      ...validInput,
      kind: 'alt_trans',
      payload: { alternative: '我热爱编程' },
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.annotation.kind).toBe('alt_trans')
    expect(d.annotation.payload.alternative).toBe('我热爱编程')
  })

  it('支持 align_fix 类型', async () => {
    const r = await postJSON('/api/translate/annotation', {
      ...validInput,
      kind: 'align_fix',
      payload: { from: [0, 0], to: [0, 1] },
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.annotation.kind).toBe('align_fix')
  })
})

describe('GET /api/translate/annotation', () => {
  it('返回指定 task 的标注列表', async () => {
    await postJSON('/api/translate/annotation', validInput)
    await postJSON('/api/translate/annotation', { ...validInput, kind: 'alt_trans', payload: { alternative: '我喜欢编程' } })

    const r = await fetch(baseUrl + '/api/translate/annotation?taskId=task-xyz')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.items.length).toBe(2)
    expect(r.headers.get('x-annotation-count')).toBe('2')
  })

  it('不存在的 task 返回空数组', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation?taskId=nonexistent')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.items).toEqual([])
  })
})

describe('DELETE /api/translate/annotation', () => {
  it('按 id 删除标注', async () => {
    const cr = await postJSON('/api/translate/annotation', validInput)
    const id = (await cr.json()).id

    const r = await fetch(baseUrl + `/api/translate/annotation?taskId=task-xyz&id=${id}`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.removed).toBe(1)

    // 确认已删除
    const lr = await fetch(baseUrl + '/api/translate/annotation?taskId=task-xyz')
    const ld = await lr.json()
    expect(ld.items.length).toBe(0)
  })

  it('删除不存在的 id 返回 404', async () => {
    await postJSON('/api/translate/annotation', validInput)
    const r = await fetch(baseUrl + '/api/translate/annotation?taskId=task-xyz&id=nonexistent-uuid', { method: 'DELETE' })
    expect(r.status).toBe(404)
  })

  it('缺 id 参数 400', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation?taskId=task-xyz', { method: 'DELETE' })
    expect(r.status).toBe(400)
  })
})
