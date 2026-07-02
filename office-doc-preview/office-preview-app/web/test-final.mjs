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

const spans = await page.$$('.pdf-text-layer span')
console.log('span 总数:', spans.length)
const firstSpan = spans[0]
if (firstSpan) {
  const cs = await firstSpan.evaluate(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), opacity: cs.opacity, color: cs.color, fontSize: cs.fontSize, pointerEvents: cs.pointerEvents, userSelect: cs.userSelect }
  })
  console.log('第一个 span:', JSON.stringify(cs, null, 2))
  
  const box = await firstSpan.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const sel = await page.evaluate(() => window.getSelection()?.toString() || '')
    console.log('selection 文本:', JSON.stringify(sel))
  }
}
await page.screenshot({ path: '/tmp/final.png' })
await browser.close()
