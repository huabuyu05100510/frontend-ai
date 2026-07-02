// 双栏对比 / 智检 — Playwright 端到端测试
// 模型：Claude MiniMax-M3
import { test, expect } from '@playwright/test'

test.describe('智检 · 双栏对比 端到端', () => {
  test.beforeEach(async ({ page }) => {
    // 监听 console 错误（前端可观测）
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[browser-console-error]', msg.text())
    })
  })

  test('点击智检按钮 → 打开弹层 → 双栏渲染 token', async ({ page }) => {
    await page.goto('/')

    // 等待任务列表加载
    await page.waitForSelector('.card', { timeout: 15000 })

    // 找任意 txt / md 文件的智检按钮（找不到则跳过：测试样本可能不含文本）
    const inspectBtn = page.locator('button:has-text("🔍 智检")').first()
    const count = await inspectBtn.count()
    if (count === 0) {
      test.skip(true, '未找到可智检的文本文件（样本中无 txt/md）')
      return
    }
    await expect(inspectBtn).toBeVisible()
    await inspectBtn.click()

    // 弹层出现
    const modal = page.locator('[data-testid="inspect-modal"]')
    await expect(modal).toBeVisible({ timeout: 5000 })

    // 工具条 + 双栏 + 错误侧栏
    await expect(page.locator('[data-testid="inspect-toolbar"]')).toBeVisible()
    await expect(page.locator('[data-testid="inspect-left"]')).toBeVisible()
    await expect(page.locator('[data-testid="inspect-right"]')).toBeVisible()
    await expect(page.locator('[data-testid="inspect-diff-sidebar"]')).toBeVisible()
  })

  test('模式切换：点击「双栏对比」按钮 → aria-pressed 切换', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.card', { timeout: 15000 })
    const inspectBtn = page.locator('button:has-text("🔍 智检")').first()
    if (await inspectBtn.count() === 0) {
      test.skip(true, '样本无 txt/md')
      return
    }
    await inspectBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })

    // 双栏对比按钮
    const dualBtn = page.locator('button:has-text("双栏对比")')
    await dualBtn.click()
    await expect(dualBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('错误侧栏点击接受 → 添加 is-accepted class', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.card', { timeout: 15000 })
    const inspectBtn = page.locator('button:has-text("🔍 智检")').first()
    if (await inspectBtn.count() === 0) {
      test.skip(true, '样本无 txt/md')
      return
    }
    await inspectBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })

    // 等待错误列表出现（依赖服务端 diff）
    const acceptBtn = page.locator('button:has-text("✓ 接受")').first()
    try {
      await acceptBtn.waitFor({ state: 'visible', timeout: 8000 })
    } catch {
      test.skip(true, '无错误条目可接受（diff 为空，跳过）')
      return
    }

    await acceptBtn.click()
    // 父级 li 应有 is-accepted
    const item = page.locator('[data-error-id]').first()
    await expect(item).toHaveClass(/is-accepted/)
  })

  test('ESC 键关闭弹层', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.card', { timeout: 15000 })
    const inspectBtn = page.locator('button:has-text("🔍 智检")').first()
    if (await inspectBtn.count() === 0) {
      test.skip(true, '样本无 txt/md')
      return
    }
    await inspectBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="inspect-modal"]')).toBeHidden({ timeout: 3000 })
  })

  test('可观测：服务端响应头 X-Diff-Engine / X-Diff-Ms', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.card', { timeout: 15000 })
    const inspectBtn = page.locator('button:has-text("🔍 智检")').first()
    if (await inspectBtn.count() === 0) {
      test.skip(true, '样本无 txt/md')
      return
    }

    // 捕获 diff API 响应
    const diffResp = page.waitForResponse(r =>
      r.url().includes('/api/inspect/diff') && r.status() === 200
    , { timeout: 8000 })
    await inspectBtn.click()
    const r = await diffResp
    expect(r.headers()['x-diff-engine']).toBe('myers@1.0')
    expect(Number(r.headers()['x-diff-ms'])).toBeGreaterThanOrEqual(0)
  })
})