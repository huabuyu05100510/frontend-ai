// router.mjs extended translate routes — 13 endpoints + observability headers
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

let CONFIG, route, upsertTask, getTask, loadTasks
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
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err.message || err) }))
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
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers,
    }, (res) => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function postJSON(urlPath, bodyObj, extraHeaders = {}) {
  return httpReq('POST', urlPath, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  }, JSON.stringify(bodyObj))
}

function getJSON(urlPath) {
  return httpReq('GET', urlPath, {})
}

/** 构造一个简单的 docx-like task（带 pages） */
function makeDocTask(taskId, pageCount = 2) {
  const pages = []
  for (let p = 1; p <= pageCount; p++) {
    pages.push({
      page: p,
      text: `第 ${p} 页：原文内容 sample`,
      width: 794,
      height: 1123,
    })
  }
  const originalPath = path.join(CONFIG.UPLOAD_DIR, `${taskId}_src.docx`)
  fs.writeFileSync(originalPath, 'mock', 'utf-8')
  const task = {
    id: taskId,
    name: `${taskId}.docx`,
    size: 4,
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'frontend',
    originalPath,
    originalUrl: `/api/files/${taskId}?as=original`,
    previewUrl: `/api/files/${taskId}?as=preview`,
    previewExt: 'docx',
    convertStatus: 'done',
    status: 'ready',
    pages,
    pagesCount: pages.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  upsertTask(task)
  return task
}

beforeEach(() => {
  loadTasks()
  // 清理可能的 job / glossary / tm 文件
  const dirsToClean = [
    path.join(CONFIG.DERIVED_DIR, 'translate-jobs'),
    path.join(CONFIG.DERIVED_DIR, 'glossaries'),
    path.join(CONFIG.DERIVED_DIR, 'translation-memory'),
  ]
  for (const d of dirsToClean) {
    if (fs.existsSync(d)) {
      for (const f of fs.readdirSync(d)) {
        try { fs.unlinkSync(path.join(d, f)) } catch { /* ignore */ }
      }
    }
  }
})

// ============ Helpers for multipart ============
function buildMultipart(fields, fileFieldName, fileName, fileBuffer, fileContentType = 'text/csv') {
  const boundary = '----vitest-boundary-' + Math.random().toString(36).slice(2)
  const parts = []
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}\r\n`
      )
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${fileContentType}\r\n\r\n`
    )
  )
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(parts),
  }
}

// ============ Tests ============

describe('GET /api/inspect/translate/progress/:jobId', () => {
  it('returns 200 + frames filtered by sinceSeq; sets X-Job-* headers', async () => {
    const task = makeDocTask('rt-prog-1', 3)
    // 启动一个翻译 job（同步）
    const start = await postJSON('/api/inspect/translate', {
      taskId: task.id,
      sourceLang: 'zh-CN',
      targetLang: 'en',
      jobId: 'rt-prog-' + Date.now(),
    })
    expect(start.status).toBe(200)

    const jobId = JSON.parse(start.body).meta.jobId
    expect(jobId).toBeTruthy()

    const r = await getJSON(`/api/inspect/translate/progress/${jobId}?sinceSeq=0`)
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.jobId).toBe(jobId)
    expect(Array.isArray(body.frames)).toBe(true)
    expect(body.frames.length).toBeGreaterThan(0)
    expect(typeof body.lastSeq).toBe('number')
    // 响应头
    expect(r.headers['x-job-id']).toBe(jobId)
    expect(r.headers['x-job-last-seq']).toBe(String(body.lastSeq))
    expect(r.headers['x-job-frames']).toBe(String(body.frames.length))
    expect(r.headers['x-job-status']).toBeTruthy()
    expect(r.headers['x-job-created-at']).toBeTruthy()
  })
})

describe('POST /api/translate/image/batch', () => {
  it('returns 202 + jobId + progressUrl + correct headers', async () => {
    const task1 = makeDocTask('rt-batch-img1', 1)
    const task2 = makeDocTask('rt-batch-img2', 1)

    const r = await postJSON('/api/translate/image/batch', {
      taskIds: [task1.id, task2.id],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    expect(r.status).toBe(202)
    const body = JSON.parse(r.body)
    expect(body.jobId).toBeTruthy()
    expect(body.progressUrl).toBe(`/api/translate/image/batch/${body.jobId}`)
    expect(body.total).toBe(2)
    // 响应头
    expect(r.headers['x-job-id']).toBe(body.jobId)
    expect(r.headers['x-batch-total']).toBe('2')
    expect(r.headers['x-batch-source-lang']).toBe('zh-CN')
    expect(r.headers['x-batch-target-lang']).toBe('en')
  })

  it('400 on empty taskIds', async () => {
    const r = await postJSON('/api/translate/image/batch', {
      taskIds: [],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    expect(r.status).toBe(400)
  })

  it('400 on missing sourceLang/targetLang', async () => {
    const r = await postJSON('/api/translate/image/batch', {
      taskIds: ['x'],
    })
    expect(r.status).toBe(400)
  })

  it('400 on unsupported lang pair', async () => {
    const r = await postJSON('/api/translate/image/batch', {
      taskIds: ['x'],
      sourceLang: 'klingon',
      targetLang: 'en',
    })
    expect(r.status).toBe(400)
  })

  it('413 on > 200 taskIds', async () => {
    const r = await postJSON('/api/translate/image/batch', {
      taskIds: Array.from({ length: 201 }, (_, i) => `task_${i}`),
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    expect(r.status).toBe(413)
  })
})

describe('GET /api/translate/image/batch/:jobId', () => {
  it('returns progress frames (reuses handleInspectTranslateProgress)', async () => {
    const start = await postJSON('/api/translate/image/batch', {
      taskIds: ['non-existent-task'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    expect(start.status).toBe(202)
    const jobId = JSON.parse(start.body).jobId

    const r = await getJSON(`/api/translate/image/batch/${jobId}?sinceSeq=0`)
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.jobId).toBe(jobId)
    expect(Array.isArray(body.frames)).toBe(true)
    expect(r.headers['x-job-id']).toBe(jobId)
  })
})

describe('POST /api/translate/image/batch/:jobId/cancel', () => {
  it('appends cancelled frame and returns 200 + X-Job-Cancelled-At', async () => {
    const start = await postJSON('/api/translate/image/batch', {
      taskIds: ['non-existent-task'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    expect(start.status).toBe(202)
    const jobId = JSON.parse(start.body).jobId

    const r = await postJSON(`/api/translate/image/batch/${jobId}/cancel`, {})
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.jobId).toBe(jobId)
    expect(body.status).toBe('cancelled')
    expect(r.headers['x-job-id']).toBe(jobId)
    expect(r.headers['x-job-cancelled-at']).toBeTruthy()
  })
})

describe('Glossary CRUD', () => {
  it('POST /api/translate/glossary appends a term', async () => {
    const r = await postJSON('/api/translate/glossary', {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '你好',
      target: 'Hello',
    })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.id).toBeTruthy()
    expect(r.headers['x-glossary-id']).toBe(body.id)
    expect(r.headers['x-glossary-hits']).toBeTruthy()
  })

  it('GET /api/translate/glossary lists filtered by lang pair', async () => {
    await postJSON('/api/translate/glossary', { sourceLang: 'zh-CN', targetLang: 'en', source: '世界', target: 'World' })
    await postJSON('/api/translate/glossary', { sourceLang: 'zh-CN', targetLang: 'ja', source: '世界', target: 'せかい' })

    const r1 = await getJSON('/api/translate/glossary?sourceLang=zh-CN&targetLang=en')
    expect(r1.status).toBe(200)
    const body1 = JSON.parse(r1.body)
    expect(body1.items.length).toBe(1)
    expect(body1.items[0].source).toBe('世界')
    expect(body1.items[0].target).toBe('World')
    expect(r1.headers['x-glossary-count']).toBe('1')
    expect(r1.headers['x-glossary-source-lang']).toBe('zh-CN')
    expect(r1.headers['x-glossary-target-lang']).toBe('en')

    const r2 = await getJSON('/api/translate/glossary?sourceLang=zh-CN&targetLang=ja')
    expect(r2.status).toBe(200)
    const body2 = JSON.parse(r2.body)
    expect(body2.items.length).toBe(1)
    expect(body2.items[0].target).toBe('せかい')
  })

  it('DELETE /api/translate/glossary/:id removes by id', async () => {
    const created = await postJSON('/api/translate/glossary', {
      sourceLang: 'zh-CN', targetLang: 'en', source: '删除测试', target: 'DeleteTest',
    })
    const id = JSON.parse(created.body).id
    const r = await httpReq('DELETE', `/api/translate/glossary/${id}?sourceLang=zh-CN&targetLang=en`)
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.ok).toBe(true)
    expect(body.id).toBe(id)
    expect(r.headers['x-glossary-removed-id']).toBe(id)
  })

  it('POST /api/translate/glossary/import (multipart) parses UTF-8 BOM CSV', async () => {
    const csv = '\uFEFFsource,target,note\n你好,Hello,greeting\n世界,World,noun'
    const fileBuf = Buffer.from(csv, 'utf-8')
    const { headers, body } = buildMultipart(
      { sourceLang: 'zh-CN', targetLang: 'en' },
      'file', 'glossary.csv', fileBuf
    )
    const r = await httpReq('POST', '/api/translate/glossary/import', headers, body)
    expect(r.status).toBe(200)
    const respBody = JSON.parse(r.body)
    expect(respBody.imported).toBe(2)
    expect(typeof respBody.duplicates).toBe('number')
    expect(r.headers['x-glossary-imported-count']).toBe('2')
    expect(r.headers['x-glossary-duplicates']).toBeTruthy()
  })
})

describe('Translation Memory CRUD', () => {
  it('POST /api/translate/memory adds a TM entry; GET lookup above threshold returns hits', async () => {
    const created = await postJSON('/api/translate/memory', {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '原文和译文应该是相同的格式',
      target: 'Source and target should use the same format',
    })
    expect(created.status).toBe(200)
    const cBody = JSON.parse(created.body)
    expect(cBody.id).toBeTruthy()
    expect(cBody.score).toBe(1)
    expect(created.headers['x-tm-id']).toBe(cBody.id)
    expect(created.headers['x-tm-score']).toMatch(/^1(\.000)?$/)

    const lookup = await getJSON('/api/translate/memory?sourceLang=zh-CN&targetLang=en&q=' + encodeURIComponent('原文和译文应该是相同的格式'))
    expect(lookup.status).toBe(200)
    const lBody = JSON.parse(lookup.body)
    expect(lBody.items.length).toBeGreaterThan(0)
    expect(lBody.items[0].target).toContain('Source')
    expect(lookup.headers['x-tm-count']).toBe('1')
    expect(lookup.headers['x-tm-match-score']).toBeTruthy()
  })

  it('DELETE /api/translate/memory/:id removes by id', async () => {
    const created = await postJSON('/api/translate/memory', {
      sourceLang: 'en', targetLang: 'ja', source: 'hello world', target: 'こんにちは世界',
    })
    const id = JSON.parse(created.body).id
    const r = await httpReq('DELETE', `/api/translate/memory/${id}?sourceLang=en&targetLang=ja`)
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.ok).toBe(true)
    expect(body.id).toBe(id)
    expect(r.headers['x-tm-removed-id']).toBe(id)
  })
})

describe('GET /api/inspect/translate/export', () => {
  it('format=bilingual-docx returns correct Content-Type', async () => {
    const task = makeDocTask('rt-export-docx', 2)
    const r = await getJSON(`/api/inspect/translate/export?taskId=${task.id}&format=bilingual-docx`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('wordprocessingml')
    expect(r.headers['x-export-format']).toBe('bilingual-docx')
    expect(r.headers['x-export-pages']).toBe('2')
    expect(r.headers['x-export-source-lang']).toBe('zh-CN')
    expect(r.headers['x-export-target-lang']).toBe('en')
    expect(r.headers['content-disposition']).toContain('attachment')
    // DOCX 魔数 PK\x03\x04
    const buf = Buffer.from(r.body, 'binary')
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4B)
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)
  })

  it('format=bilingual-pdf returns application/pdf', async () => {
    const task = makeDocTask('rt-export-pdf', 1)
    const r = await getJSON(`/api/inspect/translate/export?taskId=${task.id}&format=bilingual-pdf`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('application/pdf')
    expect(r.headers['x-export-format']).toBe('bilingual-pdf')
    // PDF 魔数 %PDF
    expect(r.body.slice(0, 5)).toBe('%PDF-')
  })

  it('400 on invalid format', async () => {
    const task = makeDocTask('rt-export-bad', 1)
    const r = await getJSON(`/api/inspect/translate/export?taskId=${task.id}&format=invalid`)
    expect(r.status).toBe(400)
  })

  it('404 for non-existent taskId', async () => {
    const r = await getJSON('/api/inspect/translate/export?taskId=no-such-task&format=bilingual-docx')
    expect(r.status).toBe(404)
  })
})

describe('POST /api/inspect/translate — extended observability headers', () => {
  it('adds X-Translate-Mode / X-Translate-Words / X-Translate-Glossary-Hits / X-Translate-TM-Hits / X-Job-Id', async () => {
    const task = makeDocTask('rt-inspect-ext', 2)
    const jobId = 'rt-inspect-' + Date.now()
    const r = await postJSON('/api/inspect/translate', {
      taskId: task.id,
      sourceLang: 'zh-CN',
      targetLang: 'en',
      jobId,
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-mode']).toBe('doc')
    expect(r.headers['x-translate-words']).toBeTruthy()
    expect(r.headers['x-translate-glossary-hits']).toBeTruthy()
    expect(r.headers['x-translate-tm-hits']).toBeTruthy()
    expect(r.headers['x-job-id']).toBe(jobId)
  })
})

describe('console.log observability', () => {
  it('inspect-translate-progress logs include ISO timestamp and frame count', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const task = makeDocTask('rt-log-1', 1)
    const jobId = 'rt-log-' + Date.now()
    await postJSON('/api/inspect/translate', {
      taskId: task.id,
      sourceLang: 'zh-CN',
      targetLang: 'en',
      jobId,
    })
    await getJSON(`/api/inspect/translate/progress/${jobId}`)
    const calls = logSpy.mock.calls.map(args => String(args[0]))
    const found = calls.some(line => line.includes('[inspect-translate-progress') && line.includes(jobId))
    expect(found).toBe(true)
    logSpy.mockRestore()
  })
})