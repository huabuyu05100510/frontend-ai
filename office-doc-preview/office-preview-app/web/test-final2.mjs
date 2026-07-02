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

// 拖选 "郭亚平"
const span = await page.$('.pdf-text-layer span')
if (span) {
  const box = await span.boundingBox()
  console.log('郭亚平 span box:', JSON.stringify(box))
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
}
await page.screenshot({ path: '/tmp/selection-new.png', fullPage: false })
console.log('截图 /tmp/selection-new.png')
await browser.close()
