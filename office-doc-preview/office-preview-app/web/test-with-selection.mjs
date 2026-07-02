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
  // 第一个 span "郭亚平"
  const firstSpan = spans[0]
  const box1 = await firstSpan.boundingBox()
  console.log('"郭亚平" box:', JSON.stringify(box1))
  // 拖选 "郭亚平"
  if (box1) {
    await page.mouse.move(box1.x + 5, box1.y + box1.height / 2)
    await page.mouse.down()
    await page.mouse.move(box1.x + box1.width - 5, box1.y + box1.height / 2, { steps: 10 })
  }
  // 第 2 个 span "求职岗位：前端工程师"
  const secondSpan = spans[1]
  const box2 = await secondSpan.boundingBox()
  console.log('"求职岗位" box:', JSON.stringify(box2))
  if (box2) {
    await page.mouse.move(box2.x + 5, box2.y + box2.height / 2)
    await page.mouse.down()
    await page.mouse.move(box2.x + box2.width - 5, box2.y + box2.height / 2, { steps: 10 })
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
  // 测 selection
  const sel = await page.evaluate(() => {
    const s = window.getSelection()
    if (!s.rangeCount) return null
    return { text: s.toString() }
  })
  console.log('selection 文本:', sel?.text)
}
await page.screenshot({ path: '/tmp/ink-with-selection.png' })
await browser.close()
