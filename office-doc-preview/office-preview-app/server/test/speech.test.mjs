// 语音能力 (TTS / ASR) 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'

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
  const r = await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r
}
async function getJSON(p) {
  return await fetch(baseUrl + p)
}

describe('POST /api/speech/tts', () => {
  it('应返回音频二进制（mock 模式 wav）', async () => {
    const res = await postJSON('/api/speech/tts', { text: '你好世界', lang: 'zh-CN' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/audio\//)
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(100)
    expect(res.headers.get('X-TTS-Engine')).toBeTruthy()
    expect(res.headers.get('X-TTS-Ms')).toBeTruthy()
  })

  it('空文本应返回 400', async () => {
    const res = await postJSON('/api/speech/tts', { text: '', lang: 'zh-CN' })
    expect(res.status).toBe(400)
  })

  it('缺失 text 字段应返回 400', async () => {
    const res = await postJSON('/api/speech/tts', { lang: 'zh-CN' })
    expect(res.status).toBe(400)
  })

  it('应支持 voice 参数选择音色', async () => {
    const res = await postJSON('/api/speech/tts', { text: 'hello', lang: 'en', voice: 'BV002_streaming' })
    expect(res.status).toBe(200)
    expect(res.headers.get('X-TTS-Voice')).toBe('BV002_streaming')
  })
})

describe('POST /api/speech/asr', () => {
  it('standalone 模式应返回 mock 占位', async () => {
    const res = await postJSON('/api/speech/asr', { taskId: 'standalone' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.engine).toBeTruthy()
    expect(typeof data.text).toBe('string')
    expect(data.segments).toBeInstanceOf(Array)
    expect(Number(data.ms)).toBeGreaterThanOrEqual(0)
    expect(res.headers.get('X-ASR-Engine')).toBeTruthy()
  })

  it('无效 taskId 应返回 404', async () => {
    const res = await postJSON('/api/speech/asr', { taskId: 'nonexistent_task_xyz' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/voice/translate', () => {
  it('应返回带 engine/cached 字段的翻译', async () => {
    const res = await postJSON('/api/voice/translate', {
      text: '你好', sourceLang: 'zh', targetLang: 'en',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('translation')
    expect(data).toHaveProperty('engine')
    expect(data).toHaveProperty('cached')
    expect(typeof data.translation).toBe('string')
  })

  it('空 text 应返回 400', async () => {
    const res = await postJSON('/api/voice/translate', { sourceLang: 'zh', targetLang: 'en' })
    expect(res.status).toBe(400)
  })

  it('LRU 缓存：第二次相同请求 cached=true', async () => {
    await postJSON('/api/voice/translate', { text: 'cache_test_xyz_unique', sourceLang: 'zh', targetLang: 'en' })
    const res = await postJSON('/api/voice/translate', { text: 'cache_test_xyz_unique', sourceLang: 'zh', targetLang: 'en' })
    const data = await res.json()
    expect(data.cached).toBe(true)
  })
})

describe('GET /api/voice/voices', () => {
  it('应返回音色列表（无凭证时降级到 fallback）', async () => {
    const res = await getJSON('/api/voice/voices')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.data).toBeInstanceOf(Array)
    expect(data.data.length).toBeGreaterThan(0)
  })
})

describe('GET /api/health/speech', () => {
  it('应返回 speech 能力状态结构', async () => {
    const res = await getJSON('/api/health/speech')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('tts')
    expect(data).toHaveProperty('asr')
    expect(data).toHaveProperty('translate')
    expect(data).toHaveProperty('providers')
    expect(data.tts.engines).toBeInstanceOf(Array)
    expect(data.tts).toHaveProperty('available')
    expect(data.asr).toHaveProperty('available')
  })
})

describe('GET /api/health/all', () => {
  it('聚合健康检查应包含 speech 字段', async () => {
    const res = await getJSON('/api/health/all')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('speech')
    expect(data.speech).toHaveProperty('tts')
    expect(data.speech).toHaveProperty('asr')
  })
})
