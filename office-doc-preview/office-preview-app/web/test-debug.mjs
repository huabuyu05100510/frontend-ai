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
console.log()
for (let i = 0; i < 5; i++) {
  const s = spans[i]
  const info = await s.evaluate(el => ({
    text: el.textContent.slice(0, 30),
    rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
    style: el.style.cssText.slice(0, 200)
  }))
  console.log(i, JSON.stringify(info, null, 2))
}
await browser.close()
