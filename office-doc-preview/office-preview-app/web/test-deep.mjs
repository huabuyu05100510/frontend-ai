import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('console', m => console.log(`[${m.type()}]`, m.text().slice(0, 200)))
await page.goto('http://localhost:5188/')
await page.waitForTimeout(5000)
const card = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (card) {
  const btn = await card.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(25000) }
}

const spans = await page.$$('.pdf-text-layer span')
console.log('span 总数:', spans.length)
for (let i = 0; i < 3; i++) {
  const info = await spans[i].evaluate(el => {
    return { 
      text: el.textContent.slice(0, 20),
      inlineTop: el.style.top, 
      inlineHeight: el.style.height,
      cssText: el.style.cssText
    }
  })
  console.log(JSON.stringify(info, null, 2))
}
await browser.close()
