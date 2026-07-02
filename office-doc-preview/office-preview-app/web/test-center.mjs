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

// 拖选 "郭" 字符
const spans = await page.$$('.pdf-text-layer span')
console.log('span 总数:', spans.length)
const firstSpan = spans[0]
if (firstSpan) {
  const box = await firstSpan.boundingBox()
  console.log('第一个 span box:', JSON.stringify(box))
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
}
await page.screenshot({ path: '/tmp/center-final.png' })
console.log('截图 /tmp/center-final.png')
await browser.close()
