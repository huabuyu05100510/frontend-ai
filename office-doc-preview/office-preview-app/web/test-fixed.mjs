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
console.log('span 总数:', spans.length)
for (let i = 0; i < 5; i++) {
  const info = await spans[i].evaluate(el => {
    return { 
      text: el.textContent.slice(0, 20),
      inlineTop: el.style.top, 
      inlineHeight: el.style.height,
      rectY: Math.round(el.getBoundingClientRect().y),
      rectH: Math.round(el.getBoundingClientRect().height)
    }
  })
  console.log(JSON.stringify(info))
}

// 拖选 "郭亚平"
const box = await spans[0].boundingBox()
if (box) {
  await page.mouse.move(box.x + 5, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}
await page.screenshot({ path: '/tmp/fixed.png' })
await browser.close()
