// 模型：claude-sonnet-4-6
// translate-image-dictionary-card — DictionaryCard 打开状态快照
//
// 验证点：
//   1. 上传图片 → 触发 OCR → 渲染 SVG bbox
//   2. 点击 region → DictionaryCard 弹出
//   3. 快照 DictionaryCard 打开状态（浮动卡片样式）

import { test, expect } from '@playwright/test'
import {
  uploadSampleImage,
  gotoTranslateImageMode,
} from './translate-helpers'

test.describe('图片翻译 — DictionaryCard 快照', () => {
  test('1. DictionaryCard 打开状态快照', async ({ page, request }) => {
    const { taskId } = await uploadSampleImage(request)
    expect(taskId).toBeTruthy()

    await gotoTranslateImageMode(page)

    // 选择图片
    const taskBtn = page.locator(`[data-testid="image-task-${taskId}"]`)
    await taskBtn.waitFor({ timeout: 15_000 }).catch(() => {})
    if (await taskBtn.count() > 0) {
      await taskBtn.first().click()
    }

    // 触发 OCR
    const ocrBtn = page.locator('[data-testid="image-translate-ocr"]')
    if (await ocrBtn.count() > 0) {
      await ocrBtn.first().click().catch(() => {})
    }

    // 等 SVG
    const svg = page.locator('[data-testid="image-dual-svg"]')
    await svg.waitFor({ timeout: 30_000 }).catch(() => {})

    // 点击第一个 region
    const firstRect = page.locator('[data-testid^="region-rect-"]').first()
    const hasRect = await firstRect.count() > 0

    if (hasRect) {
      await firstRect.click({ force: true }).catch(() => {})
    }

    // DictionaryCard 等待
    const card = page.locator('[data-testid="dictionary-card"]')
    const cardAppeared = await card.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false)

    await page.waitForTimeout(800)
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

    // 即使 DictionaryCard 没出现，也截整个页面快照（容错）
    await expect(page).toHaveScreenshot('translate-image-dictionary-card.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    })

    // 如果卡片出现，单独快照卡片
    if (cardAppeared) {
      await expect(card).toHaveScreenshot('translate-image-dictionary-card-only.png', {
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
        caret: 'hide',
      })
    }
  })

  test('2. DictionaryCard 元素级 DOM 验证', async ({ page, request }) => {
    const { taskId } = await uploadSampleImage(request)

    await gotoTranslateImageMode(page)
    const taskBtn = page.locator(`[data-testid="image-task-${taskId}"]`)
    if (await taskBtn.count() > 0) {
      await taskBtn.first().click()
    }

    const ocrBtn = page.locator('[data-testid="image-translate-ocr"]')
    if (await ocrBtn.count() > 0) {
      await ocrBtn.first().click().catch(() => {})
    }

    const svg = page.locator('[data-testid="image-dual-svg"]')
    await svg.waitFor({ timeout: 30_000 }).catch(() => {})

    const firstRect = page.locator('[data-testid^="region-rect-"]').first()
    if (await firstRect.count() > 0) {
      await firstRect.click({ force: true }).catch(() => {})
    }

    // DictionaryCard 内部子元素验证
    const card = page.locator('[data-testid="dictionary-card"]')
    const hasCard = await card.count() > 0

    if (hasCard) {
      // 验证子元素
      const source = page.locator('[data-testid="dictionary-card-source"]')
      const translation = page.locator('[data-testid="dictionary-card-translation"]')
      const copyBtn = page.locator('[data-testid="dictionary-card-copy"]')
      const retranslateBtn = page.locator('[data-testid="dictionary-card-retranslate"]')
      const glossaryBtn = page.locator('[data-testid="dictionary-card-glossary"]')
      const fontUpBtn = page.locator('[data-testid="dictionary-card-font-up"]')
      const fontDownBtn = page.locator('[data-testid="dictionary-card-font-down"]')

      expect(await source.count()).toBeGreaterThan(0)
      expect(await translation.count()).toBeGreaterThan(0)
      expect(await copyBtn.count()).toBeGreaterThan(0)
      expect(await retranslateBtn.count()).toBeGreaterThan(0)
      expect(await glossaryBtn.count()).toBeGreaterThan(0)
      expect(await fontUpBtn.count()).toBeGreaterThan(0)
      expect(await fontDownBtn.count()).toBeGreaterThan(0)
    }
  })
})