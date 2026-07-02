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
console.log('"郭亚平" 修正后 box:', JSON.stringify(box))

// 拖选——松手——立即截图
await page.mouse.move(box.x + 5, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(100)  // 极短
await page.screenshot({ path: '/tmp/sel-after.png' })
console.log('截图: mouse up 后立即')

const selInfo = await page.evaluate(() => {
  const s = window.getSelection()
  if (!s.rangeCount) return null
  const r = s.getRangeAt(0).getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: s.toString() }
})
console.log('selection rect:', JSON.stringify(selInfo))

await browser.close()
