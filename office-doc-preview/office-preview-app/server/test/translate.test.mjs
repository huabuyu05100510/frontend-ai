// /api/inspect/translate 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

// 复制 router.test.mjs 的环境准备
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

function httpReq(method, urlPath, headers = {}, body) {
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

/** 准备一个带原始文本的 txt task */
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

beforeEach(() => {
  // 重新加载 tasks（防止测试间污染）
  loadTasks()
})

describe('POST /api/inspect/translate — 翻译双栏对照', () => {
  function postTranslate(body) {
    return httpReq('POST', '/api/inspect/translate',
      { 'Content-Type': 'application/json' },
      JSON.stringify(body))
  }

  it('返回 200 + TranslateResponse（含 segments + paragraphBlocks）', async () => {
    const task = makeTxtTask('tr-1', '第一段：原文内容。\n第二段：另一段。')
    const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body).toHaveProperty('sourceLang', 'zh-CN')
    expect(body).toHaveProperty('targetLang', 'en')
    expect(body).toHaveProperty('segments')
    expect(Array.isArray(body.segments)).toBe(true)
    expect(body.segments.length).toBeGreaterThan(0)
    expect(body.segments[0]).toHaveProperty('index')
    expect(body.segments[0]).toHaveProperty('source')
    expect(body.segments[0]).toHaveProperty('target')
    expect(body).toHaveProperty('paragraphBlocks')
    expect(Array.isArray(body.paragraphBlocks)).toBe(true)
    expect(body.paragraphBlocks.length).toBeGreaterThan(0)
    expect(body).toHaveProperty('ms')
  })

  it('响应头可观测：X-Translate-Engine / X-Translate-Ms / X-Translate-Segments', async () => {
    const task = makeTxtTask('tr-2', '单段文本。')
    const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-engine']).toBeTruthy()
    expect(Number(r.headers['x-translate-ms'])).toBeGreaterThanOrEqual(0)
    expect(Number(r.headers['x-translate-segments'])).toBeGreaterThan(0)
  })

  it('mock 翻译：每段 target 含目标语言标记（[en] / [ja] / ...）', async () => {
    const task = makeTxtTask('tr-3', '第一段。\n第二段。')
    const r1 = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r1.status).toBe(200)
    const body1 = JSON.parse(r1.body)
    expect(body1.segments[0].target).toContain('[en]')

    const r2 = await postTranslate({ taskId: task.id, targetLang: 'ja', sourceLang: 'zh-CN' })
    expect(r2.status).toBe(200)
    const body2 = JSON.parse(r2.body)
    expect(body2.segments[0].target).toContain('[ja]')
  })

  it('paragraphBlocks 契约：每段 leftText 来自 segments.source，rightText 来自 segments.target', async () => {
    const task = makeTxtTask('tr-4', '原文 A。\n原文 B。')
    const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    // 翻译场景：paragraphBlocks 与 segments 1:1 严格对齐（不被 Myers paragraphDiff 错位打散）
    expect(body.paragraphBlocks.length).toBe(body.segments.length)
    body.paragraphBlocks.forEach((blk, i) => {
      expect(blk).toHaveProperty('kind')
      expect(blk).toHaveProperty('leftText')
      expect(blk).toHaveProperty('rightText')
      expect(blk.leftText).toBe(body.segments[i].source)
      expect(blk.rightText).toBe(body.segments[i].target)
      // 翻译每段必带 charOps（mock 加了 [lang] 前缀）
      expect(blk.charOps).toBeTruthy()
    })
  })

  it('taskId 不存在 → 404', async () => {
    const r = await postTranslate({ taskId: 'no-such-task', targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(404)
  })

  it('缺少 taskId → 400', async () => {
    const r = await postTranslate({ targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(400)
  })

  it('缺少 targetLang → 400', async () => {
    const task = makeTxtTask('tr-5', '内容。')
    const r = await postTranslate({ taskId: task.id, sourceLang: 'zh-CN' })
    expect(r.status).toBe(400)
  })

  it('不支持的 targetLang → 400', async () => {
    const task = makeTxtTask('tr-6', '内容。')
    const r = await postTranslate({ taskId: task.id, targetLang: 'klingon', sourceLang: 'zh-CN' })
    expect(r.status).toBe(400)
  })

  it('空文档 → 200 + 空 segments', async () => {
    const task = makeTxtTask('tr-7', '')
    const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.segments).toEqual([])
  })

  // ============ v4.2: standalone 模式（前端 TranslationPage 直接传文本，无需上传文件） ============
  it('standalone 模式：传 taskId="standalone" + text → 200 + 翻译 segments', async () => {
    const r = await postTranslate({
      taskId: 'standalone',
      targetLang: 'en',
      sourceLang: 'zh-CN',
      text: '你好，世界。这是一段测试。',
    })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body).toHaveProperty('sourceLang', 'zh-CN')
    expect(body).toHaveProperty('targetLang', 'en')
    expect(Array.isArray(body.segments)).toBe(true)
    expect(body.segments.length).toBeGreaterThan(0)
    // mock 翻译含 [en] 前缀
    expect(body.segments[0].target).toContain('[en]')
  })

  it('standalone 模式：缺 text → 400', async () => {
    const r = await postTranslate({
      taskId: 'standalone',
      targetLang: 'en',
      sourceLang: 'zh-CN',
    })
    expect(r.status).toBe(400)
  })

  it('standalone 模式：text 为空 → 200 + 空 segments', async () => {
    const r = await postTranslate({
      taskId: 'standalone',
      targetLang: 'en',
      sourceLang: 'zh-CN',
      text: '',
    })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.segments).toEqual([])
  })

  it('【回归】尾部带换行的 txt 文件：splitParagraphs 不会被 emptyRatio 启发式误判为 1 段', async () => {
    // 文件以 \n 结尾 → 1/4 行为空 → emptyRatio=0.25 > 0.1 → sep 应为 \n\n+
    // 但若无空行，\n\n+ 无法切 → 整文当 1 段（BUG）
    // translate.mjs 已在 extractTaskText 中 trim 尾部空白绕开该启发式
    const content = '第一段：原文 A。\n第二段：原文 B。\n第三段：原文 C。\n'
    const task = makeTxtTask('tr-8', content)
    const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.segments.length).toBe(3) // 必须正确分 3 段
    expect(body.segments[0].source).toBe('第一段：原文 A。')
    expect(body.segments[1].source).toBe('第二段：原文 B。')
    expect(body.segments[2].source).toBe('第三段：原文 C。')
  })

  it('【性能】50 段 × 50 字符翻译 < 200ms', async () => {
    const para = '智能校对场景测试，'.repeat(20) // 约 200 字符
    const content = Array.from({ length: 50 }, () => para).join('\n')
    const task = makeTxtTask('tr-perf', content)
    const t0 = Date.now()
    const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
    const roundMs = Date.now() - t0
    expect(r.status).toBe(200)
    expect(roundMs).toBeLessThan(400) // 含 HTTP + JSON
    expect(Number(r.headers['x-translate-ms'])).toBeLessThan(200)
  })

  // ============ 按页翻译（双语阅读模式）============
  describe('按页输出（双语阅读模式）', () => {
    it('txt 文档按 linesPerPage 分页：每页带 page / sourceText / targetText / pageW / pageH', async () => {
      // 30 行/页 → 60 行 → 2 页
      const lines = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行：原文内容。`)
      const content = lines.join('\n')
      const task = makeTxtTask('tr-page-txt', content)
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
      expect(r.status).toBe(200)
      const body = JSON.parse(r.body)
      expect(Array.isArray(body.pages)).toBe(true)
      expect(body.pages.length).toBe(2)
      body.pages.forEach((p, i) => {
        expect(p.page).toBe(i + 1)
        expect(typeof p.sourceText).toBe('string')
        expect(typeof p.targetText).toBe('string')
        expect(p.sourceText.length).toBeGreaterThan(0)
        expect(p.targetText.length).toBeGreaterThan(0)
        // v3.1: target 现在是真实 mock 翻译（不再是 [en] 前缀）
        expect(p.targetText).not.toContain('[en]')
        expect(p.targetText).not.toBe(p.sourceText)
        // charMap 字段存在
        expect(Array.isArray(p.charMap)).toBe(true)
        expect(p.charMap.length).toBeGreaterThan(0)
        expect(p.pageW).toBeGreaterThan(0)
        expect(p.pageH).toBeGreaterThan(0)
      })
      // 第 1 页 30 行；第 2 页 30 行
      expect(body.pages[0].sourceText.split('\n').length).toBe(30)
      expect(body.pages[1].sourceText.split('\n').length).toBe(30)
    })

    it('页数正确：不足一页的尾段也算 1 页', async () => {
      const content = '一行\n二行\n三行'
      const task = makeTxtTask('tr-page-tail', content)
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
      expect(r.status).toBe(200)
      const body = JSON.parse(r.body)
      expect(body.pages.length).toBe(1)
      expect(body.pages[0].page).toBe(1)
    })

    it('空文档 → 0 页（不是 1 个空页）', async () => {
      const task = makeTxtTask('tr-page-empty', '')
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
      expect(r.status).toBe(200)
      const body = JSON.parse(r.body)
      expect(body.pages).toEqual([])
    })

    it('linesPerPage 自定义（请求参数）：10 行/页 → 60 行 → 6 页', async () => {
      const lines = Array.from({ length: 60 }, (_, i) => `行 ${i + 1}`)
      const task = makeTxtTask('tr-page-custom', lines.join('\n'))
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN', linesPerPage: 10 })
      expect(r.status).toBe(200)
      const body = JSON.parse(r.body)
      expect(body.pages.length).toBe(6)
    })

    it('页尺寸默认 A4（794×1123）', async () => {
      const task = makeTxtTask('tr-page-size', '一行内容')
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
      const body = JSON.parse(r.body)
      expect(body.pages[0].pageW).toBe(794)
      expect(body.pages[0].pageH).toBe(1123)
    })

    it('X-Translate-Pages 响应头正确', async () => {
      const lines = Array.from({ length: 75 }, (_, i) => `行 ${i + 1}`)
      const task = makeTxtTask('tr-page-hdr', lines.join('\n'))
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
      expect(r.status).toBe(200)
      expect(Number(r.headers['x-translate-pages'])).toBe(3) // 75/30 = 2.5 → 3
    })

    it('pageW / pageH 自定义（如手机端 360×640）', async () => {
      const task = makeTxtTask('tr-page-custsize', '内容')
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN', pageW: 360, pageH: 640 })
      const body = JSON.parse(r.body)
      expect(body.pages[0].pageW).toBe(360)
      expect(body.pages[0].pageH).toBe(640)
    })

    it('segments 与 pages 一致：每段必须出现在某页 sourceText 里', async () => {
      const content = '段A\n段B\n段C'
      const task = makeTxtTask('tr-page-seg', content)
      const r = await postTranslate({ taskId: task.id, targetLang: 'en', sourceLang: 'zh-CN' })
      const body = JSON.parse(r.body)
      const allSrc = body.pages.map(p => p.sourceText).join('\n')
      body.segments.forEach(seg => {
        expect(allSrc).toContain(seg.source)
      })
    })
  })
})
