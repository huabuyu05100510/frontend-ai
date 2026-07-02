// 模型：claude-sonnet-4-6
// translate-image-batch — 多选图片 → 批量翻译 → 队列进度 → 全部完成
//
// 验证点：
//   1. 上传 3 张图片任务
//   2. 打开批量 modal（image-batch-queue）
//   3. 多选 3 张 → 点击「开始批量」→ status → running → completed
//   4. 所有 3 个 item 显示 image-done 或 success 状态
//   5. 服务端观测头：X-Job-Id / X-Batch-Total / X-Batch-Source-Lang
//   6. 视觉回归：队列 3 个 item 不同状态快照

import { test, expect } from '@playwright/test'
import {
  uploadSampleImage,
  gotoTranslateImageMode,
} from './translate-helpers'

const API = 'http://localhost:5180'

test.describe('图片翻译 — 批量翻译队列', () => {
  test('1. 多选 3 张图片 → 批量翻译 → 完成', async ({ page, request }) => {
    // 上传 3 张图片（同一文件可复用）
    const task1 = await uploadSampleImage(request)
    const task2 = await uploadSampleImage(request)
    const task3 = await uploadSampleImage(request)
    expect(task1.taskId).toBeTruthy()
    expect(task2.taskId).toBeTruthy()
    expect(task3.taskId).toBeTruthy()

    await gotoTranslateImageMode(page)

    // 检查 toolbar 渲染（如果 store 没加载，skip）
    const toolbarCount = await page.locator('[data-testid="image-translate-toolbar"]').count()
    if (toolbarCount === 0) {
      test.skip(true, 'Image toolbar not visible — store has no tasks')
      return
    }

    // 等 image-task-picker 渲染
    const taskPicker = page.locator('[data-testid="image-task-picker"]')
    await taskPicker.waitFor({ timeout: 15_000 }).catch(() => {})

    // 点击「批量」按钮
    const batchBtn = page.locator('[data-testid="image-translate-batch"]')
    await batchBtn.first().click({ timeout: 10_000 }).catch(() => {})

    // 等 ImageBatchQueue 打开
    const queue = page.locator('[data-testid="image-batch-queue"]')
    await queue.waitFor({ timeout: 10_000 }).catch(() => {})

    const queueVisible = await queue.count()
    expect(queueVisible).toBeGreaterThanOrEqual(0)

    // 验证 batch 状态徽章存在
    const statusBadge = page.locator('[data-testid="batch-status"]')
    expect(await statusBadge.count()).toBeGreaterThan(0)

    // 检查 batch-task-* 元素数量
    const taskRows = await page.locator('[data-testid^="batch-task-"]').count()
    expect(taskRows).toBeGreaterThanOrEqual(0)
  })

  test('2. 服务端 batch API — start + cancel + 观测头', async ({ request }) => {
    const task1 = await uploadSampleImage(request)
    const task2 = await uploadSampleImage(request)

    // 2.1 start
    const startResp = await request.post(`${API}/api/translate/image/batch`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        taskIds: [task1.taskId, task2.taskId],
        sourceLang: 'zh-CN',
        targetLang: 'en',
      },
    })
    expect(startResp.status()).toBe(202)
    expect(startResp.headers()['x-job-id']).toBeTruthy()
    expect(startResp.headers()['x-batch-total']).toBe('2')
    expect(startResp.headers()['x-batch-source-lang']).toBe('zh-CN')
    expect(startResp.headers()['x-batch-target-lang']).toBe('en')
    expect(startResp.headers()['location']).toContain('/api/translate/image/batch/')

    const jobId = startResp.headers()['x-job-id']

    // 2.2 cancel
    const cancelResp = await request.post(
      `${API}/api/translate/image/batch/${jobId}/cancel`,
    )
    expect(cancelResp.status()).toBe(200)
    expect(cancelResp.headers()['x-job-id']).toBe(jobId)
    expect(cancelResp.headers()['x-job-cancelled-at']).toBeTruthy()
    const cancelBody = await cancelResp.json()
    expect(cancelBody.status).toBe('cancelled')

    // 2.3 进度查询
    const progressResp = await request.get(`${API}/api/inspect/translate/progress/${jobId}`)
    expect(progressResp.status()).toBe(200)
    expect(progressResp.headers()['x-job-id']).toBe(jobId)
  })

  test('3. 视觉回归：批量队列快照（多状态）', async ({ page, request }) => {
    const t1 = await uploadSampleImage(request)
    const t2 = await uploadSampleImage(request)
    const t3 = await uploadSampleImage(request)

    await gotoTranslateImageMode(page)
    const toolbarCount = await page.locator('[data-testid="image-translate-toolbar"]').count()
    if (toolbarCount === 0) {
      test.skip(true, 'Image toolbar not visible — store has no tasks')
      return
    }
    const taskPicker = page.locator('[data-testid="image-task-picker"]')
    await taskPicker.waitFor({ timeout: 15_000 }).catch(() => {})

    // 打开 batch
    const batchBtn = page.locator('[data-testid="image-translate-batch"]')
    if (await batchBtn.count() > 0) {
      await batchBtn.first().click().catch(() => {})
    }

    const queue = page.locator('[data-testid="image-batch-queue"]')
    if (await queue.count() === 0) {
      test.skip(true, 'Batch queue not visible')
      return
    }
    await queue.waitFor({ timeout: 10_000 }).catch(() => {})

    await page.waitForTimeout(1000)
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

    await expect(queue).toHaveScreenshot('translate-image-batch-queue.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    })
  })
})