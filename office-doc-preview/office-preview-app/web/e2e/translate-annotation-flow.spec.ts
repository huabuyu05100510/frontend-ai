// 模型：claude-sonnet-4-6
// translate-annotation-flow — Phase D.2
//
// 验证 3 种标注 (align_fix / seg_rating / alt_trans) 完整 CRUD 流：
//   - POST 创建 3 种标注，验证 X-Translate-Annotation-* 响应头
//   - GET 列表验证 X-Translate-Annotation-Count
//   - DELETE 单条，验证 X-Translate-Annotation-Removed-Id
// 这些是 dev/QA 工具，不依赖 UI 渲染（用 ?dev=1 验证 DevHeaderBadge）

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const API = 'http://localhost:5180'
const BASE = 'http://localhost:5188'

async function postAnnotation(
  request: APIRequestContext,
  body: { taskId: string; segId: string; kind: string; text: string },
): Promise<{ status: number; headers: Record<string, string> }> {
  // 服务端 schema (annotation-schema.mjs) 必需：
  //   kind, langPair:[src,tgt], payload, srcText, tgtText, segmentId
  // langPair 必须在白名单内：zh-en / en-zh / ja-zh / …（不含 'zh-CN'）
  // 这里给齐必填字段，模拟前端 useAnnotation() 提交的实际载荷
  const fullBody = {
    kind: body.kind,
    taskId: body.taskId,
    segmentId: body.segId,
    srcText: body.text,
    tgtText: body.text,
    langPair: ['zh', 'en'],
    payload: { note: body.text },
  }
  const r = await request.post(`${API}/api/translate/annotation`, {
    headers: { 'Content-Type': 'application/json' },
    data: fullBody,
  })
  const headers: Record<string, string> = {}
  r.headersArray().forEach((h) => { headers[h.name.toLowerCase()] = h.value })
  return { status: r.status(), headers }
}

async function getAnnotation(
  request: APIRequestContext,
  taskId: string,
): Promise<{ status: number; headers: Record<string, string>; body: { items: Array<{ id: string; kind: string }> } }> {
  const r = await request.get(`${API}/api/translate/annotation?taskId=${encodeURIComponent(taskId)}`)
  const headers: Record<string, string> = {}
  r.headersArray().forEach((h) => { headers[h.name.toLowerCase()] = h.value })
  const body = await r.json()
  return { status: r.status(), headers, body }
}

async function deleteAnnotation(
  request: APIRequestContext,
  id: string,
  taskId: string,
): Promise<{ status: number; headers: Record<string, string> }> {
  // 端点: DELETE /api/translate/annotation?taskId=…&id=…
  const r = await request.delete(
    `${API}/api/translate/annotation?taskId=${encodeURIComponent(taskId)}&id=${encodeURIComponent(id)}`,
  )
  const headers: Record<string, string> = {}
  r.headersArray().forEach((h) => { headers[h.name.toLowerCase()] = h.value })
  return { status: r.status(), headers }
}

test.describe('translate-annotation-flow', () => {
  const TASK_ID = 't_anno_e2e_' + Date.now().toString(36)

  test('1. POST 3 种标注 → 验证 X-Translate-Annotation-Id/Kind/Updated-At', async ({ request }) => {
    const align = await postAnnotation(request, { taskId: TASK_ID, segId: 's_1', kind: 'align_fix', text: 'fix alignment' })
    expect(align.status).toBeGreaterThanOrEqual(200)
    expect(align.status).toBeLessThan(300)
    expect(align.headers['x-translate-annotation-id']).toBeTruthy()
    expect(align.headers['x-translate-annotation-kind']).toBe('align_fix')
    expect(align.headers['x-translate-annotation-updated-at']).toBeTruthy()

    const seg = await postAnnotation(request, { taskId: TASK_ID, segId: 's_2', kind: 'seg_rating', text: 'good translation' })
    expect(seg.headers['x-translate-annotation-kind']).toBe('seg_rating')

    const alt = await postAnnotation(request, { taskId: TASK_ID, segId: 's_3', kind: 'alt_trans', text: 'alternative wording' })
    expect(alt.headers['x-translate-annotation-kind']).toBe('alt_trans')
  })

  test('2. GET 列表 → 验证 X-Translate-Annotation-Count ≥ 3', async ({ request }) => {
    // 先确保至少 3 条存在（独立测试可能已删，重建）
    await postAnnotation(request, { taskId: TASK_ID, segId: 's_4', kind: 'align_fix', text: 'a' })
    await postAnnotation(request, { taskId: TASK_ID, segId: 's_5', kind: 'seg_rating', text: 'b' })
    await postAnnotation(request, { taskId: TASK_ID, segId: 's_6', kind: 'alt_trans', text: 'c' })

    const { status, headers, body } = await getAnnotation(request, TASK_ID)
    expect(status).toBe(200)
    expect(headers['x-translate-annotation-task-id']).toBe(TASK_ID)
    const count = Number(headers['x-translate-annotation-count'] || '0')
    expect(count).toBeGreaterThanOrEqual(3)
    expect(body.items.length).toBeGreaterThanOrEqual(3)
  })

  test('3. DELETE → 验证 X-Translate-Annotation-Removed-Id', async ({ request }) => {
    const created = await postAnnotation(request, { taskId: TASK_ID, segId: 's_99', kind: 'alt_trans', text: 'will be deleted' })
    const id = created.headers['x-translate-annotation-id']
    expect(id).toBeTruthy()

    const del = await deleteAnnotation(request, id, TASK_ID)
    expect(del.status).toBeGreaterThanOrEqual(200)
    expect(del.status).toBeLessThan(300)
    expect(del.headers['x-translate-annotation-removed-id']).toBe(id)
    expect(del.headers['x-translate-annotation-task-id']).toBe(TASK_ID)
  })
})
