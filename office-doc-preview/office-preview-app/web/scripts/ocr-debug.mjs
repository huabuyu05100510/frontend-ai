import { chromium } from '@playwright/test'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', err => console.error('[pageerror]', err.message))
  page.on('console', msg => console.log(`[${msg.type()}]`, msg.text()))

  await page.goto('http://localhost:5188')
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)

  // 导航到 OCR
  await page.locator('.oa-sidemenu-item', { hasText: /OCR/ }).click()
  await page.waitForTimeout(500)
  await page.getByText('图片识别').first().click().catch(() => {})
  await page.waitForTimeout(500)

  // 上传
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles('/Users/didi/Downloads/前端AI/office-doc-preview/files/宁波市.png')
  await page.waitForTimeout(3500)

  // 点击开始识别
  const ocrBtn = page.locator('button.xf-btn-solid').filter({ hasText: /开始识别/ }).first()
  await ocrBtn.click()
  await page.waitForTimeout(5000)

  // 检查 SVG
  const svgExists = await page.locator('[data-testid="ocr-region-svg"]').count()
  const rects = await page.locator('[data-testid^="ocr-region-rect-"]').count()
  console.log('SVG exists:', svgExists, 'rects:', rects)

  await page.screenshot({ path: '/tmp/ocr-debug.png' })
  await browser.close()
})()
