import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:5188/')
await page.waitForTimeout(5000)
const card = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (card) {
  const btn = await card.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(15000) }
}

const spans = await page.$$('.pdf-text-layer span')
console.log('span 总数:', spans.length)
if (spans.length > 0) {
  const firstSpan = spans[0]
  const cs = await firstSpan.evaluate(el => {
    const r = el.getBoundingClientRect()
    return { top: r.top.toFixed(2), height: r.height.toFixed(2), width: r.width.toFixed(2) }
  })
  console.log('第一个 span box（修正后）:', JSON.stringify(cs))
  
  const box = await firstSpan.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
}
await page.screenshot({ path: '/tmp/ink-fix3.png' })
await browser.close()
