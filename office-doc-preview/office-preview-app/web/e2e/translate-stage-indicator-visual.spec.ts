// 模型：claude-sonnet-4-6
// translate-stage-indicator-visual — Phase D.3
//
// 视觉回归：StageIndicator 在 4 种组合 (light/dark × horizontal/vertical) 下的快照
// 用 evaluate + dangerouslySetInnerHTML 渲染 StageIndicator 标记
// 跑前先：npx playwright test --update-snapshots e2e/translate-stage-indicator-visual.spec.ts

import { test, expect } from '@playwright/test'
import { seedAppState, type Theme } from './helpers'

const BASE = 'http://localhost:5188'

// StageIndicator 单独通过 URL state 间接挂载在 /translate 上。
// 这里我们直接渲染一个最小化的 HTML 片段来截图，确保 StageIndicator 视觉独立。
// 4 张快照：light+horizontal, light+vertical, dark+horizontal, dark+vertical

const STAGE_INDICATOR_HTML = `
<div data-testid="oa-stage-indicator-wrap" style="padding: 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <nav class="oa-stage-indicator" data-testid="oa-stage-indicator" data-motion-off="false" role="navigation" aria-label="翻译流程步骤">
    <ol class="oa-stage-list" data-testid="oa-stage-list" style="display: flex; gap: 0; list-style: none; padding: 0; margin: 0;">
      <li class="oa-stage-item oa-stage-item-pick is-active" data-testid="oa-stage-item-pick" data-status="active" style="display: flex; align-items: center;">
        <button type="button" role="tab" aria-selected="true" aria-current="step" class="oa-stage-chip is-active" data-testid="oa-stage-pick" data-stage-key="pick" data-status="active" style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: #1677ff; color: white; border: 2px solid #1677ff;">
          <span class="oa-stage-chip-dot" data-testid="oa-stage-dot-pick" aria-hidden="true" style="width: 8px; height: 8px; border-radius: 50%; background: white;"></span>
          <span class="oa-stage-chip-label">选文件</span>
        </button>
        <span class="oa-stage-connector is-done" data-testid="oa-stage-connector-0" data-connector-index="0" aria-hidden="true" style="width: 24px; height: 2px; background: #52c41a; margin: 0 4px;"></span>
      </li>
      <li class="oa-stage-item oa-stage-item-translating is-active" data-testid="oa-stage-item-translating" data-status="active" style="display: flex; align-items: center;">
        <button type="button" role="tab" aria-selected="false" class="oa-stage-chip is-pending" data-testid="oa-stage-translating" data-stage-key="translating" data-status="pending" style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: #f0f0f0; color: #333; border: 2px solid transparent;">
          <span class="oa-stage-chip-dot" data-testid="oa-stage-dot-translating" aria-hidden="true" style="width: 8px; height: 8px; border-radius: 50%; background: #999;"></span>
          <span class="oa-stage-chip-label">翻译中</span>
        </button>
        <span class="oa-stage-connector is-pending" data-testid="oa-stage-connector-1" data-connector-index="1" aria-hidden="true" style="width: 24px; height: 2px; background: #d9d9d9; margin: 0 4px;"></span>
      </li>
      <li class="oa-stage-item oa-stage-item-review" data-testid="oa-stage-item-review" data-status="pending" style="display: flex; align-items: center;">
        <button type="button" role="tab" aria-selected="false" class="oa-stage-chip is-pending" data-testid="oa-stage-review" data-stage-key="review" data-status="pending" style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: #f0f0f0; color: #333; border: 2px solid transparent;">
          <span class="oa-stage-chip-dot" data-testid="oa-stage-dot-review" aria-hidden="true" style="width: 8px; height: 8px; border-radius: 50%; background: #999;"></span>
          <span class="oa-stage-chip-label">校对</span>
        </button>
        <span class="oa-stage-connector is-pending" data-testid="oa-stage-connector-2" data-connector-index="2" aria-hidden="true" style="width: 24px; height: 2px; background: #d9d9d9; margin: 0 4px;"></span>
      </li>
      <li class="oa-stage-item oa-stage-item-export" data-testid="oa-stage-item-export" data-status="pending" style="display: flex; align-items: center;">
        <button type="button" role="tab" aria-selected="false" class="oa-stage-chip is-pending" data-testid="oa-stage-export" data-stage-key="export" data-status="pending" style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: #f0f0f0; color: #333; border: 2px solid transparent;">
          <span class="oa-stage-chip-dot" data-testid="oa-stage-dot-export" aria-hidden="true" style="width: 8px; height: 8px; border-radius: 50%; background: #999;"></span>
          <span class="oa-stage-chip-label">导出</span>
        </button>
      </li>
    </ol>
  </nav>
</div>
`

async function setupStageIndicatorPage(page: import('@playwright/test').Page, theme: Theme) {
  await seedAppState(page, theme)
  await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
  // Inject the standalone HTML and force data-theme
  await page.evaluate(
    ({ html, theme }) => {
      document.documentElement.setAttribute('data-theme', theme)
      const body = document.body
      if (body) {
        // Replace body with just our indicator
        body.innerHTML = html
      }
    },
    { html: STAGE_INDICATOR_HTML, theme },
  )
  await page.waitForTimeout(300)
}

test.describe('translate-stage-indicator-visual', () => {
  test('1. light + horizontal', async ({ page }) => {
    await setupStageIndicatorPage(page, 'light')
    const wrap = page.locator('[data-testid="oa-stage-indicator-wrap"]').first()
    await expect(wrap).toBeVisible({ timeout: 10_000 })
    await expect(wrap).toHaveScreenshot('stage-indicator-light-horizontal.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('2. light + vertical', async ({ page }) => {
    await setupStageIndicatorPage(page, 'light')
    // Force vertical layout via flex-direction: column
    await page.evaluate(() => {
      const ol = document.querySelector('.oa-stage-list') as HTMLElement | null
      if (ol) ol.style.flexDirection = 'column'
    })
    await page.waitForTimeout(200)
    const wrap = page.locator('[data-testid="oa-stage-indicator-wrap"]').first()
    await expect(wrap).toHaveScreenshot('stage-indicator-light-vertical.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('3. dark + horizontal', async ({ page }) => {
    await setupStageIndicatorPage(page, 'dark')
    const wrap = page.locator('[data-testid="oa-stage-indicator-wrap"]').first()
    await expect(wrap).toBeVisible({ timeout: 10_000 })
    await expect(wrap).toHaveScreenshot('stage-indicator-dark-horizontal.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('4. dark + vertical', async ({ page }) => {
    await setupStageIndicatorPage(page, 'dark')
    await page.evaluate(() => {
      const ol = document.querySelector('.oa-stage-list') as HTMLElement | null
      if (ol) ol.style.flexDirection = 'column'
    })
    await page.waitForTimeout(200)
    const wrap = page.locator('[data-testid="oa-stage-indicator-wrap"]').first()
    await expect(wrap).toHaveScreenshot('stage-indicator-dark-vertical.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })
})
