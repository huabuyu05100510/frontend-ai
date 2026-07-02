// 翻译双栏对照 — 双语阅读模式（按页对照）— Playwright 端到端验证
// 模型：claude-sonnet-4-6
import { test, expect } from '@playwright/test'

test('翻译 → 双语阅读模式：缩略图 + 按页对照 + 翻页 + 缩放', async ({ page }) => {
  // 1. 打开任务列表
  await page.goto('http://127.0.0.1:5188/')
  await page.waitForLoadState('networkidle')
  // 等任务列表
  await page.waitForSelector('.card', { timeout: 15_000 })

  // 2. 找任意 txt 文件的翻译按钮（找不到则跳过：测试样本可能不含文本）
  const translateBtn = page.locator('button:has-text("🌐 翻译")').first()
  const count = await translateBtn.count()
  if (count === 0) {
    test.skip(true, '未找到可翻译的文本文件（样本中无 txt/md）')
    return
  }
  await expect(translateBtn).toBeVisible()
  await translateBtn.click()

  // 3. 等弹层出现 + 翻译 tab 激活
  const modal = page.locator('[data-testid="inspect-modal"]')
  await expect(modal).toBeVisible()
  const translateTab = page.locator('[data-testid="tab-translate"]')
  await translateTab.click()
  await expect(translateTab).toHaveAttribute('aria-pressed', 'true')

  // 4. 截图：初始空态
  await page.screenshot({ path: '/tmp/translate-bilingual-1-empty.png', fullPage: false })

  // 5. 点击 AI 翻译
  const aiBtn = page.locator('[data-testid="translate-ai-btn"]')
  await aiBtn.click()

  // 6. 等翻译完成：缩略图 + 页面网格可见
  await page.waitForSelector('[data-testid="translate-thumbs"]', { timeout: 5000 })
  await page.waitForSelector('[data-testid="translate-pages-scroll"]', { timeout: 5000 })
  // 等 1s 让首屏完全渲染
  await page.waitForTimeout(1000)

  // 7. 验证：缩略图数量 >= 1
  const thumbCount = await page.locator('[data-testid^="thumb-"]').count()
  expect(thumbCount).toBeGreaterThan(0)

  // 8. 验证：页面行数 = 缩略图数
  const rowCount = await page.locator('.ttl-page-row').count()
  expect(rowCount).toBe(thumbCount)

  // 9. 验证：每行 left+right cell 都渲染了内容
  const firstLeft = await page.locator('.ttl-page-row[data-page="1"] .ttl-page-cell[data-side="left"]').textContent()
  const firstRight = await page.locator('.ttl-page-row[data-page="1"] .ttl-page-cell[data-side="right"]').textContent()
  expect(firstLeft).toBeTruthy()
  expect(firstRight).toBeTruthy()
  expect(firstRight).toContain('[en]') // mock 标记

  // 10. 截图：翻译完成
  await page.screenshot({ path: '/tmp/translate-bilingual-2-ready.png', fullPage: false })

  // 11. 翻页：点下一页（如果有）
  const nextBtn = page.locator('[aria-label="下一页"]')
  if (await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/translate-bilingual-3-pager.png', fullPage: false })
  }

  // 12. 缩放
  const zoomIn = page.locator('[aria-label="放大"]')
  await zoomIn.click()
  await page.waitForTimeout(300)
  const zoomText = await page.locator('[data-testid="translate-zoom"]').textContent()
  expect(zoomText).toMatch(/[1-9]\d*%/)
})
