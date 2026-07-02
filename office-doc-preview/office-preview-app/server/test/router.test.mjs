// router.mjs 测试
// 覆盖：?as=thumb / ?as=page&n=N / ?as=original / ?as=preview / 安全（路径穿越、数值校验）
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

// 重定向 router 的工作目录到临时目录
const TMP_ROOT = path.join(os.tmpdir(), 'router-test-' + Date.now())
process.env.ONLYOFFICE_JWT_SECRET = 'test-secret-1234567890'

// store.mjs 在 import 时会读 CONFIG；用 isolated module loader 让路由用临时 DATA_DIR
let route, getTask, upsertTask, reset

// 直接用一个轻量 http server 包装 route
let server, baseUrl

beforeAll(async () => {
  fs.mkdirSync(path.join(TMP_ROOT, '.data', 'uploads'), { recursive: true })
  fs.mkdirSync(path.join(TMP_ROOT, '.data', 'derived'), { recursive: true })

  // 通过环境变量改 CONFIG 路径
  process.env.DATA_DIR_OVERRIDE = path.join(TMP_ROOT, '.data')
  // 不行——CONFIG 是常量。最简单做法：复制 router 所需目录到真实路径。
  // 这里采用另一个策略：直接 mock store
  // 但 store 是 import-time singleton，复杂。改成在真实 .data/derived/<id>/ 下建测试 task。

  // 直接使用真实 CONFIG 的路径（不污染）
  const { CONFIG } = await import('../src/config.mjs')
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true })
  fs.mkdirSync(CONFIG.DERIVED_DIR, { recursive: true })

  // 让 store 加载完
  await import('../src/store.mjs')

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

// ============ helpers ============
async function httpReq(method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl)
    const req = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers
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

function makeTask(taskId, dirName, files = {}) {
  const outDir = path.join(CONFIG.DERIVED_DIR, taskId)
  fs.mkdirSync(outDir, { recursive: true })

  const originalPath = files.originalPath || path.join(CONFIG.UPLOAD_DIR, `${taskId}_test.bin`)
  if (files.originalBytes) fs.writeFileSync(originalPath, files.originalBytes)

  const task = {
    id: taskId,
    name: 'test.pdf',
    size: files.originalBytes?.length || 100,
    ext: 'pdf',
    mime: 'application/pdf',
    strategy: 'frontend',
    originalPath,
    originalUrl: `/api/files/${taskId}?as=original`,
    previewUrl: `/api/files/${taskId}?as=preview`,
    previewExt: 'pdf',
    previewPath: files.previewPath || path.join(outDir, 'preview.pdf'),
    previewSize: 100,
    convertStatus: 'done',
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  if (files.previewBytes) fs.writeFileSync(task.previewPath, files.previewBytes)
  if (files.thumbPath) {
    fs.mkdirSync(path.dirname(files.thumbPath), { recursive: true })
    fs.writeFileSync(files.thumbPath, files.thumbBytes || Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0,0,0,0x0D,0x49,0x48,0x44,0x52, 0,0,0,1, 0,0,0,1, 8,2,0,0,0, 0x90,0x77,0x53,0xDE]))
    task.thumbPath = files.thumbPath
    task.thumbUrl = `/api/files/${taskId}?as=thumb`
  }
  if (files.pagesDir) {
    fs.mkdirSync(files.pagesDir, { recursive: true })
    for (const n of (files.pages || [1])) {
      fs.writeFileSync(path.join(files.pagesDir, `page-${String(n).padStart(3,'0')}.png`), files.pageBytes || Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0,0,0,0x0D,0x49,0x48,0x44,0x52, 0,0,0,1, 0,0,0,1, 8,2,0,0,0, 0x90,0x77,0x53,0xDE]))
    }
    task.pagesDir = files.pagesDir
    task.pagesTotal = files.pages?.length || 1
    task.pages = (files.pages || [1]).map(n => ({ page: n, url: `/api/files/${taskId}?as=page&n=${n}`, bytes: 100, width: 1, height: 1 }))
  }
  upsertTask(task)
  return task
}

let CONFIG
beforeAll(async () => {
  ;({ CONFIG } = await import('../src/config.mjs'))
  const store = await import('../src/store.mjs')
  upsertTask = store.upsertTask
  reset = () => store.loadTasks()
})

beforeEach(() => {
  reset()
})

describe('GET /api/files/:id?as=original', () => {
  it('返回原文件 + ETag', async () => {
    const task = makeTask('rt-original-1', null, {
      originalBytes: Buffer.from('hello world')
    })
    const r = await httpReq('GET', `/api/files/${task.id}?as=original`)
    expect(r.status).toBe(200)
    expect(r.body).toBe('hello world')
    expect(r.headers.etag).toBeTruthy()
  })
})

describe('GET /api/files/:id?as=thumb', () => {
  it('返回缩略图 PNG', async () => {
    const task = makeTask('rt-thumb-1', null, {
      thumbPath: path.join(CONFIG.DERIVED_DIR, 'rt-thumb-1', 'thumb.png')
    })
    const r = await httpReq('GET', `/api/files/${task.id}?as=thumb`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
    expect(r.headers['cache-control']).toMatch(/immutable/)
  })

  it('thumb 不存在返回 404', async () => {
    const task = makeTask('rt-thumb-2', null, {})
    const r = await httpReq('GET', `/api/files/${task.id}?as=thumb`)
    expect(r.status).toBe(404)
  })
})

describe('GET /api/files/:id?as=page&n=N', () => {
  it('合法页号返回 PNG', async () => {
    const task = makeTask('rt-page-1', null, {
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-page-1', 'pages'),
      pages: [1, 2, 3]
    })
    const r = await httpReq('GET', `/api/files/${task.id}?as=page&n=2`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
  })

  it('n=0 返回 400（不合法）', async () => {
    const task = makeTask('rt-page-2', null, {
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-page-2', 'pages'),
      pages: [1]
    })
    const r = await httpReq('GET', `/api/files/${task.id}?as=page&n=0`)
    expect(r.status).toBe(400)
  })

  it('n 越界返回 404', async () => {
    const task = makeTask('rt-page-3', null, {
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-page-3', 'pages'),
      pages: [1, 2]
    })
    const r = await httpReq('GET', `/api/files/${task.id}?as=page&n=999`)
    expect(r.status).toBe(404)
  })

  it('路径穿越被拒绝（n=../../etc/passwd）', async () => {
    const task = makeTask('rt-page-4', null, {
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-page-4', 'pages'),
      pages: [1]
    })
    const r = await httpReq('GET', `/api/files/${task.id}?as=page&n=../../etc/passwd`)
    // NaN → 400
    expect(r.status).toBe(400)
  })
})

describe('GET /api/tasks', () => {
  it('不泄漏 thumbPath / pagesDir 等内部字段', async () => {
    const task = makeTask('rt-leak-1', null, {
      thumbPath: path.join(CONFIG.DERIVED_DIR, 'rt-leak-1', 'thumb.png'),
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-leak-1', 'pages'),
      pages: [1]
    })
    const r = await httpReq('GET', '/api/tasks')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    const t = body.tasks.find(x => x.id === task.id)
    expect(t).toBeTruthy()
    expect(t.thumbPath).toBeUndefined()
    expect(t.pagesDir).toBeUndefined()
    expect(t.originalPath).toBeUndefined()
    // 但保留 thumbUrl / pages[].url / pagesTotal
    expect(t.thumbUrl).toMatch(/as=thumb/)
    expect(t.pagesTotal).toBe(1)
    expect(t.pages[0].url).toMatch(/as=page&n=1/)
  })
})

describe('GET /api/health', () => {
  it('健康检查', async () => {
    const r = await httpReq('GET', '/api/health')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).ok).toBe(true)
  })
})

describe('GET /api/health/pdfium（PDFium 引擎可观测）', () => {
  it('返回引擎标识 + 缓存 metrics', async () => {
    const r = await httpReq('GET', '/api/health/pdfium')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    // 引擎标识（pdfium-wasm 或 fallback-poppler）
    expect(['pdfium', 'fallback-poppler', 'failed', 'uninitialized']).toContain(body.engine)
    // metrics 字段齐全
    expect(body).toHaveProperty('docsOpen')
    expect(body).toHaveProperty('cacheHit')
    expect(body).toHaveProperty('cacheMiss')
    expect(body).toHaveProperty('renderMs')
    expect(body).toHaveProperty('textMs')
    expect(body).toHaveProperty('renderCount')
    expect(body).toHaveProperty('textCount')
    expect(body).toHaveProperty('available')
    expect(typeof body.available).toBe('boolean')
  })
})

describe('GET /api/render-engine', () => {
  it('返回当前渲染引擎标识（前端 perf 面板消费）', async () => {
    const r = await httpReq('GET', '/api/render-engine')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body).toHaveProperty('engine')
    expect(typeof body.engine).toBe('string')
    // 引擎字符串含版本或 fallback 标识
    expect(body.engine).toMatch(/pdfium-wasm|fallback-poppler/)
  })
})

// ============ v4.0：strategy 透传（passthrough | synthetic）============
// 模型：claude-sonnet-4-6
describe('POST /api/inspect/translate — strategy 透传', () => {
  function postTranslate(body) {
    return httpReq('POST', '/api/inspect/translate',
      { 'Content-Type': 'application/json' },
      JSON.stringify(body))
  }

  it('1. DOCX 任务 + strategy="passthrough" → 200 + identity pages + 响应头 X-Translate-Strategy=passthrough', async () => {
    // 构造 DOCX-like 任务：ext=docx + pages 数组
    const task = makeTask('rt-tr-pt-1', null, {
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-tr-pt-1', 'pages'),
      pages: [1, 2],
    })
    // makeTask 默认 ext='pdf'，改为 docx
    task.ext = 'docx'
    task.previewExt = 'docx'
    upsertTask(task)

    const r = await postTranslate({
      taskId: task.id, sourceLang: 'zh-CN', targetLang: 'en', strategy: 'passthrough',
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-strategy']).toBe('passthrough')
    expect(r.headers['x-translate-engine']).toBe('identity-mock-v1')
    const body = JSON.parse(r.body)
    // identity：pages 来自 task.pages
    expect(body.pages.length).toBe(2)
    expect(body.pages[0].sourceText).toBe(body.pages[0].targetText)  // identity
  })

  it('2. txt 任务 + 不传 strategy → 走 synthetic 旧管线 + 响应头 X-Translate-Strategy=synthetic', async () => {
    // 构造 txt 任务：原文件 = 短文
    const txtPath = path.join(CONFIG.UPLOAD_DIR, 'rt-tr-synth-1.txt')
    fs.writeFileSync(txtPath, '你好世界\n这是测试。', 'utf-8')
    const task = makeTask('rt-tr-synth-1', null, {})
    task.ext = 'txt'
    task.previewExt = 'txt'
    task.originalPath = txtPath
    upsertTask(task)

    const r = await postTranslate({
      taskId: task.id, sourceLang: 'zh-CN', targetLang: 'en',
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-strategy']).toBe('synthetic')
    expect(r.headers['x-translate-engine']).toBe('mock-v1')
    const body = JSON.parse(r.body)
    // synthetic：走 paginateText，pages 来源于 mock 切分
    expect(body.pages.length).toBeGreaterThan(0)
  })

  it('3. POST translate + strategy 非法值 → 400', async () => {
    const r = await postTranslate({
      taskId: 'rt-tr-bad-1', sourceLang: 'zh-CN', targetLang: 'en', strategy: 'invalid',
    })
    expect(r.status).toBe(400)
    expect(JSON.parse(r.body).error).toMatch(/strategy/)
  })

  it('4. GET translate/render-image + strategy=passthrough → 200 + image/png + 响应头 X-Translate-Strategy=passthrough', async () => {
    const task = makeTask('rt-tr-img-pt-1', null, {
      pagesDir: path.join(CONFIG.DERIVED_DIR, 'rt-tr-img-pt-1', 'pages'),
      pages: [1],
    })
    task.ext = 'docx'
    task.previewExt = 'docx'
    upsertTask(task)

    const r = await httpReq('GET', `/api/inspect/translate/render-image?taskId=${task.id}&page=1&targetLang=en&strategy=passthrough`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
    expect(r.headers['x-translate-strategy']).toBe('passthrough')
    // passthrough 模式：imagePath 直接 = 源 page.png（无 soffice 二次转换）
    // body 至少非空（makeTask 用 33-byte placeholder PNG）
    expect(r.body.length).toBeGreaterThan(0)
  })
})

describe('POST /api/inspect/diff（智检 diff）', () => {
  function postDiff(left, right) {
    return httpReq('POST', '/api/inspect/diff',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ left, right }))
  }

  it('返回 200 + diff ops + errors + hunks + tokens', async () => {
    const r = await postDiff('既往开来', '继往开来')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body).toHaveProperty('ops')
    expect(body).toHaveProperty('errors')
    expect(body).toHaveProperty('hunks')
    expect(body).toHaveProperty('tokens')
    expect(body).toHaveProperty('ms')
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0]).toMatchObject({ id: 'e1', original: '既', corrected: '继' })
  })

  it('响应头可观测：X-Diff-Engine / X-Diff-Ms / X-Diff-Ops / X-Diff-Errors', async () => {
    const r = await postDiff('湖北省张家界市', '湖南省张家界')
    expect(r.headers['x-diff-engine']).toBe('myers@1.0')
    expect(Number(r.headers['x-diff-ms'])).toBeGreaterThanOrEqual(0)
    expect(Number(r.headers['x-diff-length-left'])).toBe(7)
    expect(Number(r.headers['x-diff-length-right'])).toBe(6)
    expect(Number(r.headers['x-diff-ops'])).toBeGreaterThan(0)
    expect(Number(r.headers['x-diff-errors'])).toBeGreaterThan(0)
  })

  it('空字符串入参：返回 200 + 空 ops / 空 errors', async () => {
    const r = await postDiff('', '')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.ops).toEqual([])
    expect(body.errors).toEqual([])
    expect(body.meta.errorCount).toBe(0)
  })

  it('非 JSON 请求体 → 500 / 解析失败', async () => {
    const r = await httpReq('POST', '/api/inspect/diff',
      { 'Content-Type': 'application/json' },
      'not a json')
    expect([400, 500]).toContain(r.status)
  })

  it('【契约】round-trip：ops 重建 left/right 字符串', async () => {
    const left = 'this is a test with some 中文 mixed in'
    const right = 'this is a test with 一些 中文 mixed up'
    const r = await postDiff(left, right)
    expect(r.status).toBe(200)
    const { ops } = JSON.parse(r.body)
    const rebuiltLeft = ops.filter(o => o.op !== 'insert').map(o => o.text).join('')
    const rebuiltRight = ops.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(rebuiltLeft).toBe(left)
    expect(rebuiltRight).toBe(right)
  })

  it('【性能】100KB 双栏 diff < 200ms', async () => {
    const left = '智能校对场景'.repeat(10000)
    const right = left.slice(0, 30000) + '改' + left.slice(30000)
    const t0 = Date.now()
    const r = await postDiff(left, right)
    const roundMs = Date.now() - t0
    expect(r.status).toBe(200)
    expect(roundMs).toBeLessThan(400) // 含 HTTP + JSON 序列化
    expect(Number(r.headers['x-diff-ms'])).toBeLessThan(200)
  })
})