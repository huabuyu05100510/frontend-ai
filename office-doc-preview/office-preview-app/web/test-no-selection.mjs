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

// 模拟用户操作：先拖选大范围（让 selection 持续）+ 截图
const span = await page.$('.pdf-text-layer span')
if (span) {
  const box = await span.boundingBox()
  if (box) {
    // 拖到 wrapper 整个区域
    await page.mouse.move(box.x - 20, box.y - 20)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 200, box.y + 800, { steps: 20 })
    // **关键：不松手**（模拟 selection 持续状态）
  }
}
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/selection-test.png' })
const sel = await page.evaluate(() => window.getSelection()?.toString()?.length || 0)
console.log('Selection length (still pressed):', sel)
await browser.close()
