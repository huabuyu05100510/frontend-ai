// server/test/retranslate-endpoint.test.mjs
// 模型：claude-sonnet-4-6
// Phase B.1: retranslate 端点集成测试
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { route } from '../src/router.mjs'
import { CONFIG } from '../src/config.mjs'
import * as store from '../src/store.mjs'

let server
let tmpDir

function startServer() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => route(req, res))
    s.listen(0, () => resolve(s))
  })
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) }) }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: text }) }
      })
    })
    req.on('error', reject)
    req.write(data); req.end()
  })
}

function seedTask(taskId, content = '你好世界\n这是第二段\n这是第三段') {
  // 写一个真实的 txt 文件，task.originalPath 指向它
  const originalPath = path.join(tmpDir, `${taskId}.txt`)
  fs.writeFileSync(originalPath, content, 'utf8')

  const tasks = [{
    id: taskId,
    name: `${taskId}.txt`,
    ext: 'txt',
    mime: 'text/plain',
    strategy: 'frontend',
    originalPath,
    originalUrl: `/api/files/${taskId}?as=original`,
    previewUrl: null,
    previewExt: null,
    convertStatus: 'done',
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }]
  // 写到 CONFIG.META_FILE (默认 .data/tasks.json)
  fs.mkdirSync(path.dirname(CONFIG.META_FILE), { recursive: true })
  fs.writeFileSync(CONFIG.META_FILE, JSON.stringify(tasks), 'utf8')
  // store cache 是模块级静态变量，写完后立即 reload
  store.loadTasks()
}

function writeAnno(taskId, items) {
  const dir = path.join(tmpDir, 'translate-annotations')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${taskId}.jsonl`)
  fs.writeFileSync(file, items.map((it) => JSON.stringify(it)).join('\n') + '\n', 'utf8')
}

beforeAll(async () => { server = await startServer() })
afterAll(async () => { await new Promise((r) => server.close(r)) })
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'))
  CONFIG.DERIVED_DIR = tmpDir
  // META_FILE 默认指向 ROOT/.data/tasks.json；用 tmpDir 隔离测试
  CONFIG.META_FILE = path.join(tmpDir, 'tasks.json')
  // store.mjs 的 cache 是模块级静态变量，重置它
  store.loadTasks()
})

describe('POST /api/translate/retranslate', () => {
  it('缺少 taskId → 400', async () => {
    const r = await post('/api/translate/retranslate', { sourceLang: 'zh-CN', targetLang: 'en' })
    expect(r.status).toBe(400)
  })

  it('缺少 sourceLang/targetLang → 400', async () => {
    const r = await post('/api/translate/retranslate', { taskId: 't_x' })
    expect(r.status).toBe(400)
  })

  it('taskId 不存在 → 404', async () => {
    const r = await post('/api/translate/retranslate', { taskId: 't_nope', sourceLang: 'zh-CN', targetLang: 'en' })
    expect(r.status).toBe(404)
  })

  it('空 annotations：行为同 translate()，mergedGlossary 来自 user glossary', async () => {
    const taskId = 't_rtx_1'
    seedTask(taskId)
    const r = await post('/api/translate/retranslate', {
      taskId, sourceLang: 'zh-CN', targetLang: 'en',
      glossary: [{ source: '前端', target: 'Frontend' }],
    })
    expect(r.status).toBe(200)
    expect(r.body.segments).toBeDefined()
    expect(r.body.segments.length).toBeGreaterThan(0)
    expect(r.headers['x-translate-retranslate-mode']).toBe('full')
    expect(r.headers['x-translate-retranslate-alt-trans']).toBe('0')
    expect(r.headers['x-translate-retranslate-merged-glossary-size']).toBe('1')
  })

  it('alt_trans 标注自动入 mergedGlossary', async () => {
    const taskId = 't_rtx_2'
    seedTask(taskId)
    writeAnno(taskId, [
      {
        id: 'a1', kind: 'alt_trans', taskId,
        srcSegmentId: 'seg:p1s0',
        srcText: '工程师', tgtText: '',
        payload: { altTgt: 'Engineer' },
        createdAt: Date.now(), removed: false,
      },
    ])
    const r = await post('/api/translate/retranslate', {
      taskId, sourceLang: 'zh-CN', targetLang: 'en',
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-retranslate-alt-trans']).toBe('1')
    expect(r.headers['x-translate-retranslate-merged-glossary-size']).toBe('1')
  })

  it('seg_rating<3 → retargetSegments 计数 = N', async () => {
    const taskId = 't_rtx_3'
    seedTask(taskId)
    writeAnno(taskId, [
      { id: 'a1', kind: 'seg_rating', taskId, srcSegmentId: 'seg:p1s0', srcText: 'x', tgtText: '',
        payload: { rating: 1 }, createdAt: Date.now(), removed: false },
      { id: 'a2', kind: 'seg_rating', taskId, srcSegmentId: 'seg:p1s1', srcText: 'y', tgtText: '',
        payload: { rating: 2 }, createdAt: Date.now(), removed: false },
      { id: 'a3', kind: 'seg_rating', taskId, srcSegmentId: 'seg:p1s2', srcText: 'z', tgtText: '',
        payload: { rating: 5 }, createdAt: Date.now(), removed: false },
    ])
    const r = await post('/api/translate/retranslate', {
      taskId, sourceLang: 'zh-CN', targetLang: 'en',
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-retranslate-seg-rating-low']).toBe('2')
  })

  it('onlyStaleSegments=true 且无 retarget → 仍走全档翻译', async () => {
    const taskId = 't_rtx_4'
    seedTask(taskId)
    const r = await post('/api/translate/retranslate', {
      taskId, sourceLang: 'zh-CN', targetLang: 'en',
      onlyStaleSegments: true,
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-retranslate-mode']).toBe('stale-only')
    expect(r.body.segments.length).toBeGreaterThan(0)
  })

  it('align_fix 不入 glossary，仅 alignFix 计数', async () => {
    const taskId = 't_rtx_5'
    seedTask(taskId)
    writeAnno(taskId, [
      { id: 'a1', kind: 'align_fix', taskId, srcSegmentId: 'seg:p1s0', srcText: '', tgtText: '',
        payload: {}, createdAt: Date.now(), removed: false },
    ])
    const r = await post('/api/translate/retranslate', {
      taskId, sourceLang: 'zh-CN', targetLang: 'en',
    })
    expect(r.status).toBe(200)
    expect(r.headers['x-translate-retranslate-align-fix']).toBe('1')
    expect(r.headers['x-translate-retranslate-alt-trans']).toBe('0')
    expect(r.headers['x-translate-retranslate-merged-glossary-size']).toBe('0')
  })
})
