// 翻译标注响应头可观测性测试 (Phase A.5)
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
  for (const f of fs.readdirSync(annDir)) {
    if (f.endsWith('.jsonl')) fs.unlinkSync(path.join(annDir, f))
  }
})

const validInput = {
  kind: 'seg_rating',
  taskId: 'task-obs',
  segmentId: 'seg-1',
  srcText: 'I love coding',
  tgtText: '我 喜欢 编程',
  langPair: ['en', 'zh'],
  payload: { rating: 5, comment: 'nice' },
}

describe('[observability] POST /api/translate/annotation headers', () => {
  it('returns X-Translate-Annotation-Id matching JSON id', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validInput),
    })
    const d = await r.json()
    expect(r.status).toBe(200)
    expect(r.headers.get('x-translate-annotation-id')).toBe(d.id)
  })

  it('returns X-Translate-Annotation-Kind = seg_rating', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validInput),
    })
    expect(r.headers.get('x-translate-annotation-kind')).toBe('seg_rating')
  })

  it('returns X-Translate-Annotation-Updated-At as ISO', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validInput),
    })
    const ts = r.headers.get('x-translate-annotation-updated-at')
    expect(ts).toBeTruthy()
    expect(new Date(ts).toISOString()).toBe(ts)
  })

  it('works for all 3 kinds', async () => {
    for (const kind of ['align_fix', 'seg_rating', 'alt_trans']) {
      const r = await fetch(baseUrl + '/api/translate/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validInput, kind }),
      })
      expect(r.headers.get('x-translate-annotation-kind')).toBe(kind)
    }
  })
})

describe('[observability] GET /api/translate/annotation headers', () => {
  it('returns X-Translate-Annotation-Count = N', async () => {
    for (let i = 0; i < 3; i++) {
      await fetch(baseUrl + '/api/translate/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput),
      })
    }
    const r = await fetch(baseUrl + '/api/translate/annotation?taskId=task-obs')
    expect(r.status).toBe(200)
    expect(r.headers.get('x-translate-annotation-count')).toBe('3')
  })

  it('returns X-Translate-Annotation-Task-Id', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation?taskId=task-obs')
    expect(r.headers.get('x-translate-annotation-task-id')).toBe('task-obs')
  })

  it('returns taskId=standalone when not specified', async () => {
    const r = await fetch(baseUrl + '/api/translate/annotation')
    expect(r.headers.get('x-translate-annotation-task-id')).toBe('standalone')
  })
})

describe('[observability] DELETE /api/translate/annotation headers', () => {
  it('returns X-Translate-Annotation-Removed-Id', async () => {
    const cr = await fetch(baseUrl + '/api/translate/annotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validInput),
    })
    const id = (await cr.json()).id
    const r = await fetch(`${baseUrl}/api/translate/annotation?taskId=task-obs&id=${id}`, { method: 'DELETE' })
    expect(r.headers.get('x-translate-annotation-removed-id')).toBe(id)
  })
})