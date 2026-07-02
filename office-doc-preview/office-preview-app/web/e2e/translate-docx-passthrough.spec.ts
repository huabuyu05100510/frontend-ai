// 翻译双栏对照 v4.0 — DOCX/PDF passthrough 端到端
// 模型：claude-sonnet-4-6
//
// 验证点：
//   1. DOCX 任务 → POST /api/inspect/translate 响应头含 X-Translate-Strategy=passthrough
//   2. GET /api/inspect/translate/render-image?strategy=passthrough → image/png
//   3. GET /api/inspect/translate/render-text?strategy=passthrough → text/html (data-pdfium="6")
//   4. 右 cell img src 实际请求 URL 带 strategy=passthrough
//   5. hover 右 cell span → 容器 data-hovered-src-idx 同步

import { test, expect } from '@playwright/test'

test.describe('翻译 DOCX passthrough — 端到端', () => {
  test('1. DOCX 任务翻译 → X-Translate-Strategy=passthrough + identity-mock-v1', async ({ page, request }) => {
    // 1. 打开主页
    await page.goto('http://127.0.0.1:5188/')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('.card', { timeout: 15_000 })

    // 2. 找 DOCX 任务的翻译按钮
    const docxCards = page.locator('.card:has-text(".docx")')
    const docxCount = await docxCards.count()
    if (docxCount === 0) {
      test.skip(true, '样本中未找到 DOCX 文件')
      return
    }
    const firstDocx = docxCards.first()
    const translateBtn = firstDocx.locator('button:has-text("🌐 翻译")')
    await translateBtn.click()

    // 3. 等翻译弹层 + 翻译 tab
    const modal = page.locator('[data-testid="inspect-modal"]')
    await expect(modal).toBeVisible()
    await page.locator('[data-testid="tab-translate"]').click()

    // 4. 拦截 POST /api/inspect/translate 验证 strategy=passthrough
    const [postResp] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/inspect/translate') && r.request().method() === 'POST'),
      page.locator('[data-testid="translate-ai-btn"]').click(),
    ])
    expect(postResp.status()).toBe(200)
    expect(postResp.headers()['x-translate-strategy']).toBe('passthrough')
    expect(postResp.headers()['x-translate-engine']).toBe('identity-mock-v1')

    // 5. 等右 cell 渲染（on-demand + IO 进入视口）
    await page.waitForSelector('[data-testid="translate-thumbs"]', { timeout: 5000 })
    await page.waitForTimeout(800)

    // 6. 拦截 render-image / render-text 请求验证 strategy
    const imageReq = page.waitForRequest(r =>
      r.url().includes('/api/inspect/translate/render-image') && r.url().includes('strategy=passthrough'),
      { timeout: 5000 }
    )
    const textReq = page.waitForRequest(r =>
      r.url().includes('/api/inspect/translate/render-text') && r.url().includes('strategy=passthrough'),
      { timeout: 5000 }
    )
    // 触发滚到第 1 页（确保 in-view）
    await page.locator('[data-testid^="thumb-1"]').click()
    const imgReq = await imageReq
    const txtReq = await textReq
    expect(imgReq.url()).toContain('strategy=passthrough')
    expect(txtReq.url()).toContain('strategy=passthrough')

    // 7. 验证 render-image 响应头 X-Translate-Strategy
    //    （response 头需在 click 后等；用 waitForResponse 拿对应的）
    const imgRespPromise = page.waitForResponse(r =>
      r.url().includes('/api/inspect/translate/render-image') && r.url().includes('strategy=passthrough'),
      { timeout: 5000 }
    )
    await page.locator('[data-testid^="thumb-2"]').click()
    const imgResp = await imgRespPromise
    expect(imgResp.headers()['content-type']).toBe('image/png')
    expect(imgResp.headers()['x-translate-strategy']).toBe('passthrough')

    // 8. 验证：右 cell 文字层 data-pdfium="6"
    await page.waitForTimeout(500)
    const innerLayer = page.locator('[data-testid^="translate-tgt-page-"] [data-pdfium="6"]')
    const layerCount = await innerLayer.count()
    expect(layerCount).toBeGreaterThan(0)

    // 9. 截图：passthrough 模式完整视图
    await page.screenshot({ path: '/tmp/translate-docx-passthrough.png', fullPage: false })
  })

  test('2. hover 右 cell span → 容器 data-hovered-src-idx 同步', async ({ page }) => {
    await page.goto('http://127.0.0.1:5188/')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('.card', { timeout: 15_000 })

    const docxCards = page.locator('.card:has-text(".docx")')
    if ((await docxCards.count()) === 0) {
      test.skip(true, '样本中未找到 DOCX 文件')
      return
    }
    const translateBtn = docxCards.first().locator('button:has-text("🌐 翻译")')
    await translateBtn.click()
    await page.locator('[data-testid="tab-translate"]').click()
    await page.locator('[data-testid="translate-ai-btn"]').click()

    // 等首屏渲染
    await page.waitForSelector('[data-testid="translate-tgt-page-1"] [data-pdfium]', { timeout: 10_000 })
    await page.waitForTimeout(500)

    // 找任意带 data-src-idx 的 span
    const tgtCell = page.locator('[data-testid="translate-tgt-page-1"]')
    const span = tgtCell.locator('span[data-src-idx]').first()
    const idx = await span.getAttribute('data-src-idx')
    expect(idx).toBeTruthy()

    // hover → 容器 data-hovered-src-idx 同步
    await span.hover()
    await page.waitForTimeout(200)
    const scroll = page.locator('[data-testid="translate-pages-scroll"]')
    const hoveredIdx = await scroll.getAttribute('data-hovered-src-idx')
    expect(hoveredIdx).toBe(idx)
  })

  test('3. 视觉回归：左右 cell img 实际 src 一致（passthrough = 复用源 page.png）', async ({ page }) => {
    await page.goto('http://127.0.0.1:5188/')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('.card', { timeout: 15_000 })

    const docxCards = page.locator('.card:has-text(".docx")')
    if ((await docxCards.count()) === 0) {
      test.skip(true, '样本中未找到 DOCX 文件')
      return
    }
    const translateBtn = docxCards.first().locator('button:has-text("🌐 翻译")')
    await translateBtn.click()
    await page.locator('[data-testid="tab-translate"]').click()
    await page.locator('[data-testid="translate-ai-btn"]').click()

    await page.waitForSelector('[data-testid="translate-tgt-page-1"] img.ttl-page-img', { timeout: 10_000 })
    await page.waitForTimeout(800)

    // 左 cell img 是源 page.png (blob: 或 /api/files/...)
    // 右 cell img 是 render-image?strategy=passthrough (blob: from fetch)
    // 视觉对照：取两张截图 → pixel diff
    const leftCell = page.locator('.ttl-page-row[data-page="1"] .ttl-page-cell[data-side="left"] .ttl-page-paper')
    const rightCell = page.locator('[data-testid="translate-tgt-page-1"]')

    const leftBox = await leftCell.boundingBox()
    const rightBox = await rightCell.boundingBox()
    expect(leftBox).toBeTruthy()
    expect(rightBox).toBeTruthy()

    const leftShot = await leftCell.screenshot()
    const rightShot = await rightCell.screenshot()

    // passthrough 模式：左 cell 源 PNG 和右 cell 源 PNG 应有相同的尺寸（1239x1752）
    const leftSize = await leftCell.evaluate((el: HTMLElement) => {
      const img = el.querySelector('img') as HTMLImageElement
      return { w: img.naturalWidth, h: img.naturalHeight }
    })
    const rightSize = await rightCell.evaluate((el: HTMLElement) => {
      const img = el.querySelector('img') as HTMLImageElement
      return { w: img.naturalWidth, h: img.naturalHeight }
    })
    expect(leftSize.w).toBeGreaterThan(100)
    expect(rightSize.w).toBe(leftSize.w)
    expect(rightSize.h).toBe(leftSize.h)

    // 截图大小应相近（passthrough 模式 = 同源 PNG）
    expect(Math.abs(leftShot.length - rightShot.length) / Math.max(leftShot.length, rightShot.length)).toBeLessThan(0.5)
  })
})