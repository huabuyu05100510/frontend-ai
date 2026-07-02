// Workspace Timeline CRUD + persistence 测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { CONFIG } from '../src/config.mjs'

let route
let server, baseUrl
let timelineDir

beforeAll(async () => {
  timelineDir = path.join(CONFIG.DERIVED_DIR, 'workspace-timeline')
  fs.rmSync(timelineDir, { recursive: true, force: true })
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
  fs.rmSync(timelineDir, { recursive: true, force: true })
})

beforeEach(() => {
  if (fs.existsSync(timelineDir)) {
    for (const f of fs.readdirSync(timelineDir)) {
      fs.unlinkSync(path.join(timelineDir, f))
    }
  }
})

async function postJSON(p, body) {
  return await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/workspace/timeline', () => {
  it('appends an upload record to JSONL', async () => {
    const r = await postJSON('/api/workspace/timeline', {
      kind: 'upload',
      summary: 'Uploaded contract.pdf',
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.ok).toBe(true)
    expect(d.entry.id).toBeTruthy()
    expect(d.entry.kind).toBe('upload')
    expect(d.entry.summary).toBe('Uploaded contract.pdf')
    expect(d.entry.tsIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof d.entry.ts).toBe('number')

    // file exists
    const files = fs.readdirSync(timelineDir)
    expect(files.length).toBe(1)
    const raw = fs.readFileSync(path.join(timelineDir, files[0]), 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    const obj = JSON.parse(lines[0])
    expect(obj.kind).toBe('upload')
  })

  it('accepts optional taskId and meta', async () => {
    const r = await postJSON('/api/workspace/timeline', {
      kind: 'translate',
      taskId: 't_abc',
      summary: 'Translated to English',
      meta: { sourceLang: 'zh-CN', targetLang: 'en' },
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.entry.taskId).toBe('t_abc')
    expect(d.entry.meta.targetLang).toBe('en')
  })

  it('rejects unknown kind with 400', async () => {
    const r = await postJSON('/api/workspace/timeline', {
      kind: 'unknown',
      summary: 'x',
    })
    expect(r.status).toBe(400)
  })

  it('sets X-Timeline-Kind response header', async () => {
    const r = await postJSON('/api/workspace/timeline', {
      kind: 'qc',
      summary: 'QC finished',
    })
    expect(r.headers.get('x-timeline-kind')).toBe('qc')
  })
})

describe('GET /api/workspace/timeline', () => {
  it('returns empty array when no entries', async () => {
    const r = await fetch(baseUrl + '/api/workspace/timeline')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.entries).toEqual([])
    expect(r.headers.get('x-timeline-count')).toBe('0')
  })

  it('returns entries sorted desc by ts', async () => {
    // post in order with delays
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'A' })
    await new Promise(r => setTimeout(r, 5))
    await postJSON('/api/workspace/timeline', { kind: 'translate', summary: 'B' })
    await new Promise(r => setTimeout(r, 5))
    await postJSON('/api/workspace/timeline', { kind: 'ocr', summary: 'C' })

    const r = await fetch(baseUrl + '/api/workspace/timeline')
    const d = await r.json()
    expect(d.entries.length).toBe(3)
    expect(d.entries[0].summary).toBe('C')
    expect(d.entries[2].summary).toBe('A')
    expect(r.headers.get('x-timeline-count')).toBe('3')
  })

  it('filters by kind parameter', async () => {
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'A' })
    await postJSON('/api/workspace/timeline', { kind: 'translate', summary: 'B' })
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'C' })

    const r = await fetch(baseUrl + '/api/workspace/timeline?kind=upload')
    const d = await r.json()
    expect(d.entries.length).toBe(2)
    for (const e of d.entries) expect(e.kind).toBe('upload')
  })

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await postJSON('/api/workspace/timeline', { kind: 'upload', summary: `S${i}` })
    }
    const r = await fetch(baseUrl + '/api/workspace/timeline?limit=2')
    const d = await r.json()
    expect(d.entries.length).toBe(2)
  })
})

describe('DELETE /api/workspace/timeline/:id', () => {
  it('removes single entry by id', async () => {
    const c1 = await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'A' })
    const c2 = await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'B' })
    const id1 = (await c1.json()).entry.id

    const r = await fetch(baseUrl + `/api/workspace/timeline/${id1}`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.ok).toBe(true)
    expect(d.id).toBe(id1)

    const list = await fetch(baseUrl + '/api/workspace/timeline').then(r => r.json())
    expect(list.entries.length).toBe(1)
    expect(list.entries[0].summary).toBe('B')
  })

  it('404 for unknown id', async () => {
    const r = await fetch(baseUrl + '/api/workspace/timeline/tl_doesnotexist', { method: 'DELETE' })
    expect(r.status).toBe(404)
  })
})

describe('POST /api/workspace/timeline/clear', () => {
  it('empties the file', async () => {
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'A' })
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'B' })

    const r = await postJSON('/api/workspace/timeline/clear', {})
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.ok).toBe(true)
    expect(d.cleared).toBeGreaterThanOrEqual(2)

    const list = await fetch(baseUrl + '/api/workspace/timeline').then(r => r.json())
    expect(list.entries.length).toBe(0)
  })
})

describe('malformed line resilience', () => {
  it('skips malformed lines with observability log; does not crash', async () => {
    // Append a good record
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'A' })
    // Write a bad line directly into the JSONL
    const files = fs.readdirSync(timelineDir)
    const target = path.join(timelineDir, files[0])
    fs.appendFileSync(target, '{not valid json\n')
    // Append another good one
    await postJSON('/api/workspace/timeline', { kind: 'upload', summary: 'B' })

    const r = await fetch(baseUrl + '/api/workspace/timeline')
    const d = await r.json()
    // Bad line should be skipped; 2 good entries remain
    expect(d.entries.length).toBe(2)
    expect(d.entries[0].summary).toBe('B')
    expect(d.entries[1].summary).toBe('A')
  })
})

describe('rotation', () => {
  it('rotates file after appending past maxLines; older entries archived', async () => {
    // Bypass 200-entry cap: write raw JSONL lines past 10_000 (rotation threshold)
    const file = path.join(timelineDir, 'anonymous.jsonl')
    fs.writeFileSync(file, '')
    // Write 10001 lines directly (past MAX_LINES_BEFORE_ROTATE)
    const lines = []
    for (let i = 0; i < 10001; i++) {
      lines.push(JSON.stringify({ id: `tl_e${i}`, kind: 'upload', summary: `E${i}`, ts: 1000 + i, tsIso: new Date(1000 + i).toISOString() }))
    }
    fs.writeFileSync(file, lines.join('\n') + '\n')

    const mod = await import('../src/workspace-timeline.mjs')
    // This single append should trigger rotation
    mod._appendEntryForTest({ kind: 'upload', summary: 'trigger' })

    const files = fs.readdirSync(timelineDir)
    const cur = files.find(f => f === 'anonymous.jsonl')
    const rotated = files.find(f => f !== 'anonymous.jsonl')
    expect(cur).toBeDefined()
    expect(rotated).toBeDefined()
    const curLines = fs.readFileSync(path.join(timelineDir, cur), 'utf-8').split('\n').filter(Boolean)
    expect(curLines.length).toBe(1)
    const rotatedLines = fs.readFileSync(path.join(timelineDir, rotated), 'utf-8').split('\n').filter(Boolean)
    expect(rotatedLines.length).toBe(10001)
  })
})

describe('cap enforcement', () => {
  it('caps each user at 200 entries (no more after limit)', async () => {
    for (let i = 0; i < 220; i++) {
      await postJSON('/api/workspace/timeline', { kind: 'upload', summary: `C${i}` })
    }
    const r = await fetch(baseUrl + '/api/workspace/timeline')
    const d = await r.json()
    // Either cap kicked in (≤200) or rotation occurred; in either case not >200
    expect(d.entries.length).toBeLessThanOrEqual(200)
  })
})