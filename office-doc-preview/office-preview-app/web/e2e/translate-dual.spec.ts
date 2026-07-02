// 翻译双栏对照 — Playwright 端到端测试
// 模型：claude-sonnet-4-6（由 glm-5.2 调用）
// v4.2 更新：mount 自动触发翻译；新增格式选择器（PDF / 图片+文字 / WASM）
import { test, expect } from '@playwright/test'

test.describe('翻译双栏对照 端到端', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[browser-console-error]', msg.text())
    })
  })

  test('点击「🌐 翻译」→ 打开智检弹层 → 翻译对照 tab 激活', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid^="task-translate-"]', { timeout: 15000 })

    const translateBtn = page.locator('[data-testid^="task-translate-"]').first()
    await expect(translateBtn).toBeVisible()
    await translateBtn.click()

    // 智检弹层 + 翻译 tab 激活
    const modal = page.locator('[data-testid="inspect-modal"]')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const translateTab = page.locator('[data-testid="tab-translate"]')
    await expect(translateTab).toHaveAttribute('aria-pressed', 'true')

    // v4.2：AI 翻译按钮 + 格式选择器三按钮均渲染
    await expect(page.locator('[data-testid="translate-ai-btn"]')).toBeVisible()
    await expect(page.locator('[data-testid="translate-mode-pdf"]')).toBeVisible()
    await expect(page.locator('[data-testid="translate-mode-images"]')).toBeVisible()
    await expect(page.locator('[data-testid="translate-mode-wasm"]')).toBeVisible()
  })

  test('【v4.2】mount 自动触发翻译 — 无需手点 AI 翻译按钮', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid^="task-translate-"]', { timeout: 15000 })

    const translateBtn = page.locator('[data-testid^="task-translate-"]').first()
    // 监听 translate 请求（在点击前注册，确保能捕获 mount 触发的请求）
    const translateResp = page.waitForResponse(
      r => r.url().endsWith('/api/inspect/translate') && r.status() === 200,
      { timeout: 15000 }
    )
    await translateBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })

    // 无需任何点击，mount 即触发
    const r = await translateResp
    expect(r.status()).toBe(200)

    // 页面网格渲染（直接进入 ready，不再有 idle 空态稳定态）
    await expect(page.locator('.ttl-page-row').first()).toBeVisible({ timeout: 8000 })
  })

  test('【v4.2】格式选择器：默认 images 模式高亮', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid^="task-translate-"]', { timeout: 15000 })

    const translateBtn = page.locator('[data-testid^="task-translate-"]').first()
    await translateBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })

    const imagesBtn = page.locator('[data-testid="translate-mode-images"]')
    await expect(imagesBtn).toHaveClass(/on/)
  })

  test('【v4.2】格式选择器：切换 PDF 模式 → 渲染 iframe', async ({ page }) => {
    await page.goto('/')
    // 找一个 PDF/DOCX 任务（有源 PDF 才支持 PDF 模式）
    const docTranslateBtns = page.locator('[data-testid^="task-translate-"]')
    await page.waitForSelector('.card', { timeout: 15000 })
    // 等待所有卡片加载
    await page.waitForTimeout(500)

    // 选一个 enabled 的翻译按钮（PDF/DOCX 卡片）
    const allBtns = await docTranslateBtns.all()
    let targetBtn = null
    for (const b of allBtns) {
      if (await b.isEnabled()) {
        // 检查是否 docx/pdf：通过卡片 name
        const card = b.locator('xpath=ancestor::div[contains(@class,"card")]')
        const name = (await card.locator('.card-name').textContent()) || ''
        if (/pdf|docx|doc/i.test(name)) {
          targetBtn = b
          break
        }
      }
    }
    if (!targetBtn) {
      test.skip(true, '样本无 PDF/DOCX 文件，跳过 PDF 模式测试')
      return
    }
    await targetBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })

    // 等 mount 自动触发完成
    await expect(page.locator('.ttl-page-row').first()).toBeVisible({ timeout: 15000 })

    // PDF 按钮应可用
    const pdfBtn = page.locator('[data-testid="translate-mode-pdf"]')
    await expect(pdfBtn).toBeEnabled()
    await pdfBtn.click()

    // v4.3：出现 embed.ttl-cell-pdf（每行 cell 一个单页 embed）
    await expect(page.locator('embed.ttl-cell-pdf').first()).toBeVisible({ timeout: 5000 })
  })

  test('【v4.2】格式选择器：切换 WASM 模式', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.card', { timeout: 15000 })
    await page.waitForTimeout(500)

    const allBtns = await page.locator('[data-testid^="task-translate-"]').all()
    let targetBtn = null
    for (const b of allBtns) {
      if (await b.isEnabled()) {
        const card = b.locator('xpath=ancestor::div[contains(@class,"card")]')
        const name = (await card.locator('.card-name').textContent()) || ''
        if (/pdf|docx|doc/i.test(name)) {
          targetBtn = b
          break
        }
      }
    }
    if (!targetBtn) {
      test.skip(true, '样本无 PDF/DOCX 文件，跳过 WASM 模式测试')
      return
    }
    await targetBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })
    await expect(page.locator('.ttl-page-row').first()).toBeVisible({ timeout: 15000 })

    const wasmBtn = page.locator('[data-testid="translate-mode-wasm"]')
    await expect(wasmBtn).toBeEnabled()
    await wasmBtn.click()
    // WASM 模式按钮高亮
    await expect(wasmBtn).toHaveClass(/on/)
  })

  test('关闭弹层 → 翻译状态被清理', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid^="task-translate-"]', { timeout: 15000 })
    const translateBtn = page.locator('[data-testid^="task-translate-"]').first()
    await translateBtn.click()
    await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })

    // 关闭
    await page.locator('button[aria-label="关闭"]').click()
    await expect(page.locator('[data-testid="inspect-modal"]')).not.toBeVisible()
  })

  // ========== v4.3：PDF / WASM 模式滚动同步 + 按页对应 ==========

  /** 找到一个 PDF/DOCX 任务并打开翻译弹层 */
  async function openDocxTranslate(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.waitForSelector('.card', { timeout: 15000 })
    await page.waitForTimeout(500)
    const allBtns = await page.locator('[data-testid^="task-translate-"]').all()
    for (const b of allBtns) {
      if (!(await b.isEnabled())) continue
      const card = b.locator('xpath=ancestor::div[contains(@class,"card")]')
      const name = (await card.locator('.card-name').textContent()) || ''
      if (/pdf|docx|doc/i.test(name)) {
        await b.click()
        await page.locator('[data-testid="inspect-modal"]').waitFor({ state: 'visible' })
        await expect(page.locator('.ttl-page-row').first()).toBeVisible({ timeout: 15000 })
        return true
      }
    }
    return false
  }

  test('【v4.3】PDF 模式：每行 cell 含 embed（按页对应，不再嵌整本 iframe）', async ({ page }) => {
    const found = await openDocxTranslate(page)
    if (!found) { test.skip(true, '样本无 PDF/DOCX'); return }

    const pdfBtn = page.locator('[data-testid="translate-mode-pdf"]')
    await pdfBtn.click()
    await page.waitForTimeout(1000)

    // 每行左右 cell 各一个 embed
    const rows = page.locator('.ttl-page-row')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < rowCount; i++) {
      const leftEmbed = rows.nth(i).locator('.ttl-page-cell[data-side="left"] embed.ttl-cell-pdf')
      const rightEmbed = rows.nth(i).locator('.ttl-page-cell[data-side="right"] embed.ttl-cell-pdf')
      await expect(leftEmbed).toHaveCount(1)
      await expect(rightEmbed).toHaveCount(1)
    }
  })

  test('【v4.3】PDF 模式：滚动外层 → 左右 cell 同步（同行 y 一致）', async ({ page }) => {
    const found = await openDocxTranslate(page)
    if (!found) { test.skip(true, '样本无 PDF/DOCX'); return }

    await page.locator('[data-testid="translate-mode-pdf"]').click()
    await page.waitForTimeout(1500)

    const scroll = page.locator('[data-testid="translate-pages-scroll"]')
    // 滚到中段
    await scroll.evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight * 0.4 })
    await page.waitForTimeout(500)

    // 第 2 行左右 cell 的 boundingClientRect.top 应该相同（行内对齐）
    const row2 = page.locator('.ttl-page-row').nth(1)
    const leftBox = await row2.locator('.ttl-page-cell[data-side="left"]').boundingBox()
    const rightBox = await row2.locator('.ttl-page-cell[data-side="right"]').boundingBox()
    expect(leftBox).toBeTruthy()
    expect(rightBox).toBeTruthy()
    // 同行 y 容差 5px
    expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThan(5)
  })

  test('【v4.3】WASM 模式：每行 cell 含单页 canvas slot（不再嵌整本文档）', async ({ page }) => {
    const found = await openDocxTranslate(page)
    if (!found) { test.skip(true, '样本无 PDF/DOCX'); return }

    await page.locator('[data-testid="translate-mode-wasm"]').click()
    await page.waitForTimeout(2000)

    const rows = page.locator('.ttl-page-row')
    const rowCount = await rows.count()
    for (let i = 0; i < rowCount; i++) {
      // 每行左 cell 含一个 .pdf-page-wasm 单页 slot
      const leftSlot = rows.nth(i).locator('.ttl-page-cell[data-side="left"] .pdf-page-wasm')
      await expect(leftSlot).toHaveCount(1)
      // slot 暴露 data-page 对应页号
      const dataPage = await leftSlot.getAttribute('data-page')
      expect(dataPage).toBe(String(i + 1))
    }
    // 不应该渲染整本文档查看器 .pdf-root
    expect(await page.locator('.pdf-root').count()).toBe(0)
  })
})
