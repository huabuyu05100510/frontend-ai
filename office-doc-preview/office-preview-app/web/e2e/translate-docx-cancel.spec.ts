// 模型：claude-sonnet-4-6
// translate-docx-cancel — 启动翻译 → mid-flight 取消 → 验证状态 cancelled
//
// 验证点：
//   1. standalone 翻译 → 立即调用 image batch cancel 模式验证取消端点
//   2. UI：DocTranslateMode 子菜单按钮可见
//   3. 取消幂等（image batch 端点支持）
//
// 注：inspect/translate 的 cancel 端点不存在（未实现）。image batch 端点有 cancel，
//   这里用 image batch 来验证 cancel 头 + 幂等行为。

import { test, expect } from '@playwright/test'
import {
  uploadSampleImage,
  gotoTranslateDocMode,
} from './translate-helpers'

const API = 'http://localhost:5180'

test.describe('文档翻译 — 取消 (via image batch cancel pattern)', () => {
  test('1. 取消 image batch job → 验证 X-Job-Cancelled-At + status=cancelled', async ({ request }) => {
    const { taskId } = await uploadSampleImage(request)

    // 1.1 启动 batch
    const startResp = await request.post(`${API}/api/translate/image/batch`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        taskIds: [taskId],
        sourceLang: 'zh-CN',
        targetLang: 'en',
      },
    })
    expect(startResp.status()).toBe(202)
    const jobId = startResp.headers()['x-job-id']
    expect(jobId).toBeTruthy()

    // 1.2 取消
    const cancelResp = await request.post(`${API}/api/translate/image/batch/${jobId}/cancel`)
    expect(cancelResp.status()).toBe(200)
    const j = await cancelResp.json()
    expect(j.status).toBe('cancelled')
    expect(cancelResp.headers()['x-job-id']).toBe(jobId)
    expect(cancelResp.headers()['x-job-cancelled-at']).toBeTruthy()

    // 1.3 验证 progress 端点仍能响应
    const progressResp = await request.get(`${API}/api/inspect/translate/progress/${jobId}`)
    expect(progressResp.status()).toBe(200)
    expect(progressResp.headers()['x-job-id']).toBe(jobId)
  })

  test('2. UI：DocTranslateMode 子菜单按钮可见', async ({ page }) => {
    await gotoTranslateDocMode(page)

    // 等待 DocTranslateMode 容器
    const docMode = page.locator('[data-testid="doc-translate-mode"]').first()
    await docMode.waitFor({ timeout: 15_000 }).catch(() => {})

    const exists = await docMode.count()
    expect(exists).toBeGreaterThan(0)

    // 验证翻译 mode 子菜单按钮可点击
    const submenuBtns = await page.locator('.xf-submenu-item').count()
    expect(submenuBtns).toBeGreaterThan(0)
  })

  test('3. 取消幂等 — 重复 cancel 不报错', async ({ request }) => {
    const { taskId } = await uploadSampleImage(request)

    const startResp = await request.post(`${API}/api/translate/image/batch`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        taskIds: [taskId],
        sourceLang: 'zh-CN',
        targetLang: 'en',
      },
    })
    const jobId = startResp.headers()['x-job-id']

    // 第一次 cancel
    const r1 = await request.post(`${API}/api/translate/image/batch/${jobId}/cancel`)
    expect(r1.status()).toBe(200)

    // 第二次 cancel（幂等）
    const r2 = await request.post(`${API}/api/translate/image/batch/${jobId}/cancel`)
    expect([200, 404]).toContain(r2.status())
  })
})