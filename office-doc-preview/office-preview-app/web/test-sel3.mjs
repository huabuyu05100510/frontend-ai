import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:5188/')
await page.waitForTimeout(5000)
const card = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (card) {
  const btn = await card.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(25000) }
}

const spans = await page.$$('.pdf-text-layer span')
const box = await spans[0].boundingBox()
console.log('"郭亚平" box:', JSON.stringify(box))

// 拖选——**保持按住不松手**截图（selection 还在显示中）
await page.mouse.move(box.x + 5, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 5 })
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/sel-still-down.png' })
console.log('截图: mouse 仍 down')

await browser.close()
