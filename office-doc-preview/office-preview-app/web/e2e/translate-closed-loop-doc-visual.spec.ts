// 模型：claude-sonnet-4-6
// translate-closed-loop-doc-visual — Phase D.3
//
// 视觉回归：文档翻译 4 阶段 (pick / translating / review / export) 视觉快照
// 跑前先：npx playwright test --update-snapshots e2e/translate-closed-loop-doc-visual.spec.ts

import { test, expect } from '@playwright/test'
import { seedAppState } from './helpers'

const BASE = 'http://localhost:5188'

// 4 个 stage 的简化 HTML 模拟（用真实 testid 但简化布局）
const STAGE_PICK_HTML = `
<div data-testid="oa-doc-stage-pick-tile" style="padding: 24px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <header data-testid="oa-stage-indicator" style="display: flex; gap: 8px; margin-bottom: 16px;">
    <button data-testid="oa-stage-pick" data-status="active" style="padding: 6px 14px; border-radius: 999px; background: #1677ff; color: white; border: none; font-weight: 500;">选文件</button>
    <button data-testid="oa-stage-translating" data-status="pending" style="padding: 6px 14px; border-radius: 999px; background: #f0f0f0; color: #333; border: none;">翻译中</button>
    <button data-testid="oa-stage-review" data-status="pending" style="padding: 6px 14px; border-radius: 999px; background: #f0f0f0; color: #333; border: none;">校对</button>
    <button data-testid="oa-stage-export" data-status="pending" style="padding: 6px 14px; border-radius: 999px; background: #f0f0f0; color: #333; border: none;">导出</button>
  </header>
  <div data-testid="oa-doc-stage-pick" style="border: 1px solid #d9d9d9; border-radius: 8px; padding: 24px; min-height: 200px; text-align: center; color: #666;">
    <p>请选择 docx 文件开始翻译</p>
    <button data-testid="oa-doc-stage-start" style="margin-top: 12px; padding: 8px 24px; background: #1677ff; color: white; border: none; border-radius: 6px;">选择文件</button>
  </div>
</div>
`

const STAGE_TRANSLATING_HTML = `
<div data-testid="oa-doc-stage-translating-tile" style="padding: 24px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <header data-testid="oa-stage-indicator" style="display: flex; gap: 8px; margin-bottom: 16px;">
    <button data-testid="oa-stage-pick" data-status="done" style="padding: 6px 14px; border-radius: 999px; background: #52c41a; color: white; border: none;">选文件</button>
    <button data-testid="oa-stage-translating" data-status="active" style="padding: 6px 14px; border-radius: 999px; background: #1677ff; color: white; border: none;">翻译中</button>
    <button data-testid="oa-stage-review" data-status="pending" style="padding: 6px 14px; border-radius: 999px; background: #f0f0f0; color: #333; border: none;">校对</button>
    <button data-testid="oa-stage-export" data-status="pending" style="padding: 6px 14px; border-radius: 999px; background: #f0f0f0; color: #333; border: none;">导出</button>
  </header>
  <div data-testid="oa-doc-stage-progress" style="border: 1px solid #d9d9d9; border-radius: 8px; padding: 24px; min-height: 200px;">
    <div style="display: flex; align-items: center; gap: 16px;">
      <div data-testid="xf-progress-ring" style="width: 64px; height: 64px; border-radius: 50%; background: conic-gradient(#1677ff 0% 60%, #f0f0f0 60% 100%); display: flex; align-items: center; justify-content: center;">
        <span style="background: white; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #1677ff;">60%</span>
      </div>
      <div>
        <p style="margin: 0 0 4px; font-weight: 500;">翻译中...</p>
        <p style="margin: 0; color: #666; font-size: 13px;">页面 3 / 5 · 状态 running</p>
      </div>
    </div>
  </div>
</div>
`

const STAGE_REVIEW_HTML = `
<div data-testid="oa-doc-stage-review-tile" style="padding: 24px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <header data-testid="oa-stage-indicator" style="display: flex; gap: 8px; margin-bottom: 16px;">
    <button data-testid="oa-stage-pick" data-status="done" style="padding: 6px 14px; border-radius: 999px; background: #52c41a; color: white; border: none;">选文件</button>
    <button data-testid="oa-stage-translating" data-status="done" style="padding: 6px 14px; border-radius: 999px; background: #52c41a; color: white; border: none;">翻译中</button>
    <button data-testid="oa-stage-review" data-status="active" style="padding: 6px 14px; border-radius: 999px; background: #1677ff; color: white; border: none;">校对</button>
    <button data-testid="oa-stage-export" data-status="pending" style="padding: 6px 14px; border-radius: 999px; background: #f0f0f0; color: #333; border: none;">导出</button>
  </header>
  <div data-testid="oa-split" data-direction="horizontal" style="display: flex; flex-direction: row; height: 240px; border: 1px solid #d9d9d9; border-radius: 8px; overflow: hidden;">
    <div data-testid="oa-split-pane-primary" style="flex-basis: 50%; background: #e6f4ff; padding: 16px; color: #333;">原文双栏</div>
    <div data-testid="oa-split-handle" style="width: 4px; background: #d9d9d9; cursor: col-resize;"></div>
    <div data-testid="oa-split-pane-secondary" style="flex-basis: 0; flex-grow: 1; background: #f6ffed; padding: 16px; color: #333;">译文双栏</div>
  </div>
</div>
`

const STAGE_EXPORT_HTML = `
<div data-testid="oa-doc-stage-export-tile" style="padding: 24px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <header data-testid="oa-stage-indicator" style="display: flex; gap: 8px; margin-bottom: 16px;">
    <button data-testid="oa-stage-pick" data-status="done" style="padding: 6px 14px; border-radius: 999px; background: #52c41a; color: white; border: none;">选文件</button>
    <button data-testid="oa-stage-translating" data-status="done" style="padding: 6px 14px; border-radius: 999px; background: #52c41a; color: white; border: none;">翻译中</button>
    <button data-testid="oa-stage-review" data-status="done" style="padding: 6px 14px; border-radius: 999px; background: #52c41a; color: white; border: none;">校对</button>
    <button data-testid="oa-stage-export" data-status="active" style="padding: 6px 14px; border-radius: 999px; background: #1677ff; color: white; border: none;">导出</button>
  </header>
  <div data-testid="oa-doc-stage-export" style="border: 1px solid #d9d9d9; border-radius: 8px; padding: 24px;">
    <fieldset>
      <legend style="font-weight: 500;">输出格式</legend>
      <label style="display: block; padding: 6px 0;"><input type="radio" name="fmt" checked /> 双语 DOCX</label>
      <label style="display: block; padding: 6px 0;"><input type="radio" name="fmt" /> 双语 PDF</label>
      <label style="display: block; padding: 6px 0;"><input type="radio" name="fmt" /> 译文 PDF</label>
    </fieldset>
    <button data-testid="oa-doc-stage-export-go" style="margin-top: 16px; padding: 8px 24px; background: #1677ff; color: white; border: none; border-radius: 6px;">导出</button>
  </div>
</div>
`

test.describe('translate-closed-loop-doc-visual', () => {
  test('1. pick stage', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: STAGE_PICK_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-doc-stage-pick-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('closed-loop-doc-pick.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('2. translating stage', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: STAGE_TRANSLATING_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-doc-stage-translating-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('closed-loop-doc-translating.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('3. review stage', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: STAGE_REVIEW_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-doc-stage-review-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('closed-loop-doc-review.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })

  test('4. export stage', async ({ page }) => {
    await seedAppState(page, 'light')
    await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ({ html, theme }) => {
        document.documentElement.setAttribute('data-theme', theme)
        document.body.innerHTML = html
      },
      { html: STAGE_EXPORT_HTML, theme: 'light' },
    )
    await page.waitForTimeout(300)
    const tile = page.locator('[data-testid="oa-doc-stage-export-tile"]').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    await expect(tile).toHaveScreenshot('closed-loop-doc-export.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
      animations: 'disabled',
    })
  })
})
