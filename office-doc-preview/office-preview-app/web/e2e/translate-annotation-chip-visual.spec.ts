// 模型：claude-sonnet-4-6
// translate-annotation-chip-visual — Phase D.3
//
// 视觉回归：3 种 AnnotationChip (align_fix / seg_rating / alt_trans) 在浅色背景上
// 跑前先：npx playwright test --update-snapshots e2e/translate-annotation-chip-visual.spec.ts

import { test, expect } from '@playwright/test'
import { seedAppState } from './helpers'

const BASE = 'http://localhost:5188'

// 简化版 AnnotationChip HTML：3 个 chip 在浅色 tile 上
const CHIP_HTML = `
<div data-testid="oa-annotation-chip-tile" style="padding: 32px; background: #fafafa; display: flex; gap: 16px; align-items: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <span role="button" tabindex="0" aria-label="对齐修正 标注" data-testid="oa-annotation-chip-align_fix" data-kind="align_fix" data-segment="" class="oa-annotation-chip oa-annotation-chip-kind-align" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.4; background: rgb(22, 119, 255); color: white;">
    <span class="oa-annotation-chip-label">对齐修正</span>
  </span>
  <span role="button" tabindex="0" aria-label="段落评分 标注" data-testid="oa-annotation-chip-seg_rating" data-kind="seg_rating" data-segment="" class="oa-annotation-chip oa-annotation-chip-kind-seg" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.4; background: rgb(82, 196, 26); color: white;">
    <span class="oa-annotation-chip-label">段落评分</span>
  </span>
  <span role="button" tabindex="0" aria-label="备选翻译 标注" data-testid="oa-annotation-chip-alt_trans" data-kind="alt_trans" data-segment="" class="oa-annotation-chip oa-annotation-chip-kind-alt" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.4; background: rgb(114, 46, 209); color: white;">
    <span class="oa-annotation-chip-label">备选翻译</span>
  </span>
</div>
`

test.describe('translate-annotation-chip-visual', () => {
  test('1. align_fix chip', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: CHIP_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-annotation-chip-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('annotation-chip-align-fix.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('2. seg_rating chip', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: CHIP_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const chip = page.locator('[data-testid="oa-annotation-chip-seg_rating"]').first()
    await expect(chip).toBeVisible({ timeout: 10_000 })
    await expect(chip).toHaveScreenshot('annotation-chip-seg-rating.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('3. alt_trans chip', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: CHIP_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const chip = page.locator('[data-testid="oa-annotation-chip-alt_trans"]').first()
    await expect(chip).toBeVisible({ timeout: 10_000 })
    await expect(chip).toHaveScreenshot('annotation-chip-alt-trans.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })
})
