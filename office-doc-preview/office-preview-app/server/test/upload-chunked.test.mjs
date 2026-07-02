// 分片上传 + 秒传 + 历史 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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

function buildMultipart(fields) {
  const boundary = '----test_boundary_' + Math.random().toString(36).slice(2)
  const parts = []
  for (const [name, val] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\n`)
    if (val && typeof val === 'object' && 'filename' in val) {
      parts.push(`Content-Disposition: form-data; name="${name}"; filename="${val.filename}"\r\n`)
      parts.push(`Content-Type: application/octet-stream\r\n\r\n`)
      parts.push(val.data)
      parts.push('\r\n')
    } else {
      parts.push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`)
      parts.push(String(val))
      parts.push('\r\n')
    }
  }
  parts.push(`--${boundary}--\r\n`)
  const body = Buffer.concat(parts.map(p => (typeof p === 'string' ? Buffer.from(p, 'utf8') : p)))
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

async function postMultipart(p, fields) {
  const { body, contentType } = buildMultipart(fields)
  return await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
}

describe('POST /api/upload/check', () => {
  it('非法 hash 应返回 400', async () => {
    const r = await postJSON('/api/upload/check', { hash: 'not-a-hash', fileName: 'a.txt' })
    expect(r.status).toBe(400)
  })

  it('未命中的 hash 应返回 404 exists:false', async () => {
    const r = await postJSON('/api/upload/check', { hash: 'abcdef0123456789', fileName: 'a.txt' })
    expect(r.status).toBe(404)
    const d = await r.json()
    expect(d.exists).toBe(false)
  })
})

describe('POST /api/upload/chunk + merge 完整流程', () => {
  it('接收分片 → 合并 → 返回 taskId + url', async () => {
    const hash = 'a'.repeat(64)  // 模拟 sha-256 hex
    const total = 3
    const chunks = [
      Buffer.from('Hello, '),
      Buffer.from('chunked '),
      Buffer.from('world!'),
    ]
    // 上传 3 个分片
    for (let i = 0; i < total; i++) {
      const r = await postMultipart('/api/upload/chunk', {
        chunk: { filename: `${hash}_${i}`, data: chunks[i] },
        hash,
        index: i,
        total,
      })
      expect(r.status).toBe(200)
      const d = await r.json()
      expect(d.index).toBe(i)
      expect(d.received).toBe(i + 1)
      expect(d.total).toBe(total)
    }

    // 合并
    const merge = await postJSON('/api/upload/merge', {
      hash, total, fileName: 'merged.txt', merkleRoot: 'root123',
    })
    expect(merge.status).toBe(200)
    const md = await merge.json()
    expect(md.ok).toBe(true)
    expect(md.taskId).toBeTruthy()
    expect(md.url).toContain('/api/files/')
    expect(md.task.name).toBe('merged.txt')
    expect(merge.headers.get('X-Merge-Merkle')).toBe('verified')
    expect(merge.headers.get('X-Merge-Bytes')).toBe(String(21))
  })

  it('分片缺失时 merge 应返回 400', async () => {
    const hash = 'b'.repeat(64)
    // 上传 1 个分片，声称 total=3
    await postMultipart('/api/upload/chunk', {
      chunk: { filename: `${hash}_0`, data: Buffer.from('only one') },
      hash, index: 0, total: 3,
    })
    const merge = await postJSON('/api/upload/merge', { hash, total: 3, fileName: 'broken.txt' })
    expect(merge.status).toBe(400)
    expect((await merge.json()).error).toMatch(/missing chunk/)
  })

  it('合并后秒传检查应命中', async () => {
    const hash = 'c'.repeat(64)
    await postMultipart('/api/upload/chunk', {
      chunk: { filename: `${hash}_0`, data: Buffer.from('instant check') },
      hash, index: 0, total: 1,
    })
    await postJSON('/api/upload/merge', { hash, total: 1, fileName: 'instant.txt' })

    const check = await postJSON('/api/upload/check', { hash, fileName: 'instant.txt' })
    expect(check.status).toBe(200)
    const d = await check.json()
    expect(d.exists).toBe(true)
    expect(d.taskId).toBeTruthy()
    expect(d.url).toContain('/api/files/')
    expect(check.headers.get('X-Upload-Instant')).toBe('true')
  })
})

describe('GET /api/upload/history', () => {
  it('应返回倒序的上传历史', async () => {
    // 注入几个任务
    const t1 = Date.now()
    upsertTask({
      id: 'hist_1', name: 'old.txt', size: 10, ext: 'txt',
      mime: 'text/plain', strategy: 'frontend',
      originalUrl: '/api/files/hist_1?as=original',
      convertStatus: 'done', status: 'ready',
      createdAt: t1 - 5000, updatedAt: t1 - 5000,
    })
    upsertTask({
      id: 'hist_2', name: 'new.txt', size: 20, ext: 'txt',
      mime: 'text/plain', strategy: 'frontend',
      originalUrl: '/api/files/hist_2?as=original',
      convertStatus: 'done', status: 'ready',
      createdAt: t1, updatedAt: t1,
    })

    const r = await fetch(baseUrl + '/api/upload/history')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(Array.isArray(d.items)).toBe(true)
    expect(d.items.length).toBeGreaterThan(0)
    // 倒序：最新的在前
    const idx1 = d.items.findIndex(i => i.id === 'hist_1')
    const idx2 = d.items.findIndex(i => i.id === 'hist_2')
    expect(idx2).toBeLessThan(idx1)
    expect(r.headers.get('X-History-Count')).toBeTruthy()
  })
})
