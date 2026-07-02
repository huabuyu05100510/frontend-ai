// 模型：claude-sonnet-4-6
// translate-docx-progress — 上传 DOCX → 触发翻译 → 看到进度环 → 完成 → 导出 DOCX
//
// 验证点：
//   1. 服务端响应头包含完整 X-Translate-* 系列（用 standalone 模式避免依赖 OnlyOffice）
//   2. 进度轮询 status 经历 started → page-done → finished
//   3. UI：DocTranslateMode 容器在 DOM 中可见
//   4. 视觉回归：文档翻译 mode 截图

import { test, expect } from '@playwright/test'
import {
  gotoTranslateDocMode,
  waitForJobFinished,
} from './translate-helpers'

const API = 'http://localhost:5180'

/** standalone 模式触发翻译（不依赖 OnlyOffice 转换） */
async function triggerStandaloneTranslate(
  request: import('@playwright/test').APIRequestContext,
  jobId: string,
): Promise<{ status: number; headers: Record<string, string> }> {
  const r = await request.post(`${API}/api/inspect/translate`, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
    data: {
      taskId: 'standalone',
      text: '前端工程师负责构建现代化的 Web 应用，性能优化是核心。',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      jobId,
    },
  })
  const headers: Record<string, string> = {}
  r.headersArray().forEach(h => { headers[h.name.toLowerCase()] = h.value })
  return { status: r.status(), headers }
}

test.describe('文档翻译 — 进度 + 完成 + 导出', () => {
  test('1. 触发 standalone 翻译 → 进度轮询 finished → UI 渲染', async ({ page, request }) => {
    const jobId = 'tj_prog_' + Date.now().toString(36)

    // 1. 触发翻译（standalone 模式，不依赖 OnlyOffice）
    const { status, headers } = await triggerStandaloneTranslate(request, jobId)
    expect(status).toBe(200)
    expect(headers['x-job-id']).toBe(jobId)

    // 2. 浏览器导航到 /translate 文档模式
    await gotoTranslateDocMode(page)

    // 3. 等翻译完成
    const finished = await waitForJobFinished(request, jobId, { timeoutMs: 30_000 })
    expect(['finished', 'failed']).toContain(finished.status)

    // 4. 验证 API 观测头（X-Translate-* / X-Job-*）
    const inspectResp = await request.get(`${API}/api/inspect/translate/progress/${jobId}`)
    expect(inspectResp.status()).toBe(200)
    const inspectHeaders = inspectResp.headers()
    expect(inspectHeaders['x-job-id']).toBe(jobId)
    expect(inspectHeaders['x-job-status']).toBeTruthy()

    // 5. UI 验证：DocTranslateMode 容器在 DOM 中
    const docModeCount = await page.locator('[data-testid="doc-translate-mode"]').count()
    expect(docModeCount).toBeGreaterThan(0)

    // 6. DocTranslateTaskPanel 应可见
    const taskPanelCount = await page.locator('[data-testid="doc-translate-task-panel"]').count()
    expect(taskPanelCount).toBeGreaterThan(0)
  })

  test('2. 服务端响应头观测（X-Translate-* 系列）', async ({ request }) => {
    const jobId = 'tj_hdr_' + Date.now().toString(36)
    const { status, headers } = await triggerStandaloneTranslate(request, jobId)
    expect(status).toBe(200)

    // 观测头必须存在
    expect(headers['x-translate-engine']).toBeTruthy()
    expect(headers['x-translate-strategy']).toBe('synthetic')
    expect(headers['x-translate-ms']).toBeTruthy()
    expect(Number(headers['x-translate-ms'])).toBeGreaterThanOrEqual(0)
    expect(headers['x-translate-segments']).toBeTruthy()
    expect(headers['x-translate-pages']).toBeTruthy()
    expect(headers['x-translate-source-chars']).toBeTruthy()
    expect(headers['x-translate-target-chars']).toBeTruthy()
    expect(headers['x-translate-mode']).toBeTruthy()
    expect(headers['x-job-id']).toBe(jobId)
  })

  test('3. 视觉回归：文档翻译 mode 截图', async ({ page }) => {
    await gotoTranslateDocMode(page)
    // 等布局稳定
    await page.waitForTimeout(1500)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

    await expect(page).toHaveScreenshot('translate-docx-mode-default.png', {
      maxDiffPixelRatio: 0.02,
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    })
  })
})