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
for (let i = 0; i < 5; i++) {
  const info = await spans[i].evaluate(el => ({
    text: el.textContent.slice(0, 20),
    top: el.style.top,
    height: el.style.height,
    rectY: Math.round(el.getBoundingClientRect().y),
    rectH: Math.round(el.getBoundingClientRect().height)
  }))
  console.log(JSON.stringify(info))
}
await browser.close()
