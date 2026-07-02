// 模型：claude-sonnet-4-6
// translate-resizable-split-visual — Phase D.3
//
// 视觉回归：ResizableSplit 在 30/70 + 50/50 两种比例下的快照
// 跑前先：npx playwright test --update-snapshots e2e/translate-resizable-split-visual.spec.ts

import { test, expect } from '@playwright/test'
import { seedAppState } from './helpers'

const BASE = 'http://localhost:5188'

const SPLIT_HTML_30_70 = `
<div data-testid="oa-split-tile" style="padding: 24px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div data-testid="oa-split" data-storage-key="visual-30-70" data-direction="horizontal" style="display: flex; flex-direction: row; width: 600px; height: 200px; border: 1px solid #d9d9d9; border-radius: 8px; overflow: hidden;">
    <div data-testid="oa-split-pane-primary" style="flex-basis: 30%; background: #e6f4ff; display: flex; align-items: center; justify-content: center; color: #1677ff; font-weight: 500;">30% 原文</div>
    <div data-testid="oa-split-handle" role="separator" aria-orientation="vertical" aria-valuenow="30" aria-label="水平拖拽分隔条，当前 30%" tabindex="0" style="width: 4px; background: #d9d9d9; cursor: col-resize;"></div>
    <div data-testid="oa-split-pane-secondary" style="flex-basis: 0; flex-grow: 1; background: #f6ffed; display: flex; align-items: center; justify-content: center; color: #389e0d; font-weight: 500;">70% 译文</div>
  </div>
</div>
`

const SPLIT_HTML_50_50 = `
<div data-testid="oa-split-tile" style="padding: 24px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div data-testid="oa-split" data-storage-key="visual-50-50" data-direction="horizontal" style="display: flex; flex-direction: row; width: 600px; height: 200px; border: 1px solid #d9d9d9; border-radius: 8px; overflow: hidden;">
    <div data-testid="oa-split-pane-primary" style="flex-basis: 50%; background: #e6f4ff; display: flex; align-items: center; justify-content: center; color: #1677ff; font-weight: 500;">50% 原文</div>
    <div data-testid="oa-split-handle" role="separator" aria-orientation="vertical" aria-valuenow="50" aria-label="水平拖拽分隔条，当前 50%" tabindex="0" style="width: 4px; background: #d9d9d9; cursor: col-resize;"></div>
    <div data-testid="oa-split-pane-secondary" style="flex-basis: 0; flex-grow: 1; background: #f6ffed; display: flex; align-items: center; justify-content: center; color: #389e0d; font-weight: 500;">50% 译文</div>
  </div>
</div>
`

test.describe('translate-resizable-split-visual', () => {
  test('1. 30/70 split', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: SPLIT_HTML_30_70, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-split-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('resizable-split-30-70.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('2. 50/50 split', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: SPLIT_HTML_50_50, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-split-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('resizable-split-50-50.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })
})
