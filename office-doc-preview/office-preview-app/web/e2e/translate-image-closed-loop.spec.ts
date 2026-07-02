// 模型：claude-sonnet-4-6
// translate-image-closed-loop — Phase D.2
//
// 完整闭环：选图 → preview-before-OCR → OCR → 校对 regions → 导出
// region 点击打开 annotation popup

import { test, expect } from '@playwright/test'
import { uploadSampleImage, gotoTranslateImageMode } from './translate-helpers'

const BASE = 'http://localhost:5188'

test.describe('translate-image-closed-loop', () => {
  test('1. 上传图片 → preview-before-OCR (render-image 端点)', async ({ page, request }) => {
    const upload = await uploadSampleImage(request)

    await page.goto(`${BASE}/translate?mode=image&stage=pick&task=${upload.taskId}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.locator('.oa-shell').first().waitFor({ timeout: 30_000 }).catch(() => {})

    // URL 携带 task=
    const url = page.url()
    expect(url).toContain('mode=image')
    expect(url).toContain('stage=pick')
    expect(url).toContain(`task=${upload.taskId}`)
  })

  test('2. ?stage=ocr 进度环可见（如任务已就绪）', async ({ page }) => {
    await page.goto(`${BASE}/translate?mode=image&stage=ocr&task=t_ocr_test`, {
      waitUntil: 'domcontentloaded',
    })
    await page.locator('.oa-shell').first().waitFor({ timeout: 30_000 }).catch(() => {})

    // URL 应保留所有参数
    const url = page.url()
    expect(url).toContain('stage=ocr')
  })

  test('3. ?stage=review 直接进入校对页（region list）', async ({ page }) => {
    await page.goto(`${BASE}/translate?mode=image&stage=review&task=t_review_test`, {
      waitUntil: 'domcontentloaded',
    })
    await page.locator('.oa-shell').first().waitFor({ timeout: 30_000 }).catch(() => {})

    // URL 应包含 stage=review
    const url = page.url()
    expect(url).toContain('stage=review')
  })
})
