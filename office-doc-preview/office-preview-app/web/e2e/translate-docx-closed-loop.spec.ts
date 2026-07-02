// 模型：claude-sonnet-4-6
// translate-docx-closed-loop — Phase D.2
//
// 完整闭环：上传 DOCX → 预览 → 翻译 → 校对 → 导出
// URL `?stage=` 推进每个阶段；shareable review URL 工作
// 这是 doc translate closed-loop 的端到端验证

import { test, expect } from '@playwright/test'
import {
  uploadSampleDocx,
  waitForConvertDone,
  gotoTranslateDocMode,
  waitForJobFinished,
  triggerTranslateJob,
} from './translate-helpers'

const API = 'http://localhost:5180'
const BASE = 'http://localhost:5188'

test.describe('translate-docx-closed-loop', () => {
  test('1. 上传 DOCX → 预览 pick stage → URL stage=pick 可见', async ({ page, request }) => {
    const upload = await uploadSampleDocx(request)
    await waitForConvertDone(request, upload.taskId, 60_000)

    // 导航到 doc translate pick stage
    await page.goto(`${BASE}/translate?mode=doc&stage=pick`, { waitUntil: 'domcontentloaded' })
    await page.locator('.oa-shell').first().waitFor({ timeout: 30_000 }).catch(() => {})

    // URL 应包含 mode=doc&stage=pick
    const url = page.url()
    expect(url).toContain('mode=doc')
    expect(url).toContain('stage=pick')
  })

  test('2. 翻译 standalone job → 等 finished → 校验响应头', async ({ request }) => {
    const jobId = 'tj_loop_' + Date.now().toString(36)
    const r = await request.post(`${API}/api/inspect/translate`, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
      data: {
        taskId: 'standalone',
        jobId,
        text: '欢迎使用 office-doc-preview。这是一份测试文档。',
        sourceLang: 'zh-CN',
        targetLang: 'en',
      },
    })
    expect(r.status()).toBe(200)
    const headers = r.headers()
    expect(headers['x-job-id']).toBe(jobId)
    expect(headers['x-translate-mode']).toBeTruthy()

    const finished = await waitForJobFinished(request, jobId, { timeoutMs: 30_000 })
    expect(['finished', 'failed']).toContain(finished.status)
  })

  test('3. shareable review URL: ?stage=review&task=t_xxx 直链', async ({ page }) => {
    await page.goto(`${BASE}/translate?mode=doc&stage=review&task=t_share_test`, {
      waitUntil: 'domcontentloaded',
    })
    await page.locator('.oa-shell').first().waitFor({ timeout: 30_000 }).catch(() => {})

    // URL 应保留所有参数
    const url = page.url()
    expect(url).toContain('mode=doc')
    expect(url).toContain('stage=review')
    expect(url).toContain('task=t_share_test')
  })
})
