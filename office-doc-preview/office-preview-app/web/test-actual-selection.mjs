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

// 拖选 "郭亚平" 区域
const spans = await page.$$('.pdf-text-layer span')
const firstSpan = spans[0]
if (firstSpan) {
  const box = await firstSpan.boundingBox()
  const cs = await firstSpan.evaluate(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), fontSize: cs.fontSize, lineHeight: cs.lineHeight }
  })
  console.log('span box:', JSON.stringify(cs))
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const sel = await page.evaluate(() => {
      const s = window.getSelection()
      if (!s.rangeCount) return null
      const r = s.getRangeAt(0).getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: s.toString() }
    })
    console.log('selection box:', JSON.stringify(sel))
  }
}
await page.screenshot({ path: '/tmp/actual-selection.png' })
await browser.close()
