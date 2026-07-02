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
// 拖选 "郭亚平" 整行
const spans = await page.$$('.pdf-text-layer span')
console.log('span 总数:', spans.length)
// 看前 3 个 span（"郭亚平"）
for (let i = 0; i < 3; i++) {
  const s = spans[i]
  const text = await s.textContent()
  const cs = await s.evaluate(el => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  console.log(`  '${text}' box:`, JSON.stringify(cs))
}
const firstSpan = spans[0]
if (firstSpan) {
  const box = await firstSpan.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
}
await page.screenshot({ path: '/tmp/line-bbox.png' })
await browser.close()
