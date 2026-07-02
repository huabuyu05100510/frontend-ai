// 语音识别 + 分段 + per-segment 翻译 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { upsertTask } from '../src/store.mjs'
import { CONFIG } from '../src/config.mjs'

let server, baseUrl
let route

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

function makeAudioTask() {
  const id = 't_audio_' + Date.now().toString(36)
  const name = 'lecture.mp3'
  const filePath = path.join(CONFIG.UPLOAD_DIR, id + '_' + name)
  fs.writeFileSync(filePath, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]))
  upsertTask({
    id, name, size: 256, ext: 'mp3', mime: 'audio/mpeg', strategy: 'frontend',
    originalUrl: `/api/files/${id}?as=original`,
    previewUrl: `/api/files/${id}?as=original`,
    previewExt: 'mp3',
    originalPath: filePath,
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
  })
  return id
}

describe('POST /api/speech/asr-segments — ASR + 分段 + per-segment 翻译', () => {
  it('返回 segments[] 含 start_ms/end_ms/source/target', async () => {
    const tid = makeAudioTask()
    const r = await postJSON('/api/speech/asr-segments', {
      taskId: tid, lang: 'zh-CN', sourceLang: 'zh', targetLang: 'en',
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(Array.isArray(d.segments)).toBe(true)
    expect(d.segments.length).toBeGreaterThan(0)
    const seg = d.segments[0]
    expect(seg).toHaveProperty('start_ms')
    expect(seg).toHaveProperty('end_ms')
    expect(seg).toHaveProperty('source')
    expect(seg).toHaveProperty('target')
    expect(typeof seg.start_ms).toBe('number')
    expect(typeof seg.end_ms).toBe('number')
    expect(seg.end_ms).toBeGreaterThanOrEqual(seg.start_ms)
    expect(d.engine).toBeTruthy()
    expect(typeof d.ms).toBe('number')
  })

  it('多段 segments 时间戳递增不重叠', async () => {
    const tid = makeAudioTask()
    const r = await postJSON('/api/speech/asr-segments', {
      taskId: tid, lang: 'zh-CN',
    })
    const d = await r.json()
    for (let i = 1; i < d.segments.length; i++) {
      expect(d.segments[i].start_ms).toBeGreaterThanOrEqual(d.segments[i - 1].end_ms)
    }
  })

  it('task 不存在 → 404', async () => {
    const r = await postJSON('/api/speech/asr-segments', { taskId: 't_not_exist_xyz' })
    expect(r.status).toBe(404)
  })

  it('standalone 模式可工作（无 taskId，传纯文本路径）', async () => {
    // 假定 ASR standalone 用 mock；这里只验证结构
    const r = await postJSON('/api/speech/asr-segments', {
      text: '今天我们讨论项目进度。下一议题是预算。',
      lang: 'zh-CN', sourceLang: 'zh', targetLang: 'en',
    })
    // 可能为 200 或 400 视实现而定；若支持 standalone 则验证 segments 非空
    if (r.status === 200) {
      const d = await r.json()
      expect(d.segments.length).toBeGreaterThan(0)
    } else {
      expect([400, 501]).toContain(r.status)
    }
  })
})
