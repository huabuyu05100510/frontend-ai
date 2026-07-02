// 标注 /api/annotate 端点测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import { _resetCacheForTests } from '../src/annotate.mjs'

let route
let server, baseUrl

beforeAll(async () => {
  const { CONFIG } = await import('../src/config.mjs')
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true })
  fs.mkdirSync(CONFIG.DERIVED_DIR, { recursive: true })
  await import('../src/store.mjs')
  _resetCacheForTests()
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

describe('POST /api/annotate', () => {
  it('缺失 taskId 应返回 400', async () => {
    const r = await postJSON('/api/annotate', { page: 1, text: 'hi' })
    expect(r.status).toBe(400)
  })

  it('缺失 text 应返回 400', async () => {
    const r = await postJSON('/api/annotate', { taskId: 't_anno_1', page: 1 })
    expect(r.status).toBe(400)
  })

  it('非法 page 应返回 400', async () => {
    const r = await postJSON('/api/annotate', { taskId: 't_anno_1', page: 0, text: 'hi' })
    expect(r.status).toBe(400)
  })

  it('合法请求应返回新建标注', async () => {
    const r = await postJSON('/api/annotate', {
      taskId: 't_anno_demo', page: 2, text: '重点', note: '此处需复核', color: '#ffd6e7',
    })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.id).toMatch(/^a_/)
    expect(d.taskId).toBe('t_anno_demo')
    expect(d.page).toBe(2)
    expect(d.text).toBe('重点')
    expect(d.note).toBe('此处需复核')
    expect(d.color).toBe('#ffd6e7')
    expect(r.headers.get('X-Annotate-Id')).toBe(d.id)
  })
})

describe('GET /api/annotate/:taskId', () => {
  it('应返回该任务全部标注', async () => {
    await postJSON('/api/annotate', { taskId: 't_anno_list', page: 1, text: 'a' })
    await postJSON('/api/annotate', { taskId: 't_anno_list', page: 1, text: 'b' })

    const r = await fetch(baseUrl + '/api/annotate/t_anno_list')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.taskId).toBe('t_anno_list')
    expect(d.annotations.length).toBeGreaterThanOrEqual(2)
    expect(d.annotations[0]).toHaveProperty('id')
    expect(r.headers.get('X-Annotate-Count')).toBeTruthy()
  })

  it('无标注任务应返回空数组', async () => {
    const r = await fetch(baseUrl + '/api/annotate/t_anno_empty')
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.annotations).toEqual([])
  })
})

describe('DELETE /api/annotate/:id', () => {
  it('应删除已存在的标注', async () => {
    const cr = await postJSON('/api/annotate', { taskId: 't_anno_del', page: 1, text: 'x' })
    const ann = await cr.json()

    const r = await fetch(baseUrl + `/api/annotate/${ann.id}?taskId=t_anno_del`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.ok).toBe(true)

    // 再查应为空
    const gr = await fetch(baseUrl + '/api/annotate/t_anno_del')
    const gd = await gr.json()
    expect(gd.annotations.find(a => a.id === ann.id)).toBeUndefined()
  })

  it('删除不存在的标注应返回 404', async () => {
    const r = await fetch(baseUrl + '/api/annotate/a_nonexistent?taskId=t_anno_missing', { method: 'DELETE' })
    expect(r.status).toBe(404)
  })

  it('缺 taskId 参数应返回 400', async () => {
    const r = await fetch(baseUrl + '/api/annotate/a_whatever', { method: 'DELETE' })
    expect(r.status).toBe(400)
  })
})
