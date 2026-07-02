import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:5188/')
await page.waitForTimeout(3000)
const card = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (card) {
  const btn = await card.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(8000) }
}

// 模拟用户在 "郭亚平"区域拖选
const span = await page.$('.pdf-text-layer span')
if (span) {
  const box = await span.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 50, box.y + 30)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 200, box.y + 200, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
}
await page.screenshot({ path: '/tmp/actual-selection.png' })
await browser.close()
