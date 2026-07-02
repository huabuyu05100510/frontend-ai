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

// 测 selection 工作
const spans = await page.$$('.pdf-text-layer span')
const firstSpan = spans[0]
if (firstSpan) {
  const cs = await firstSpan.evaluate(el => {
    const cs = getComputedStyle(el)
    return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color, opacity: cs.opacity, pointerEvents: cs.pointerEvents, userSelect: cs.userSelect, height: cs.height }
  })
  console.log('第一个 span computed:', JSON.stringify(cs, null, 2))
  
  const box = await firstSpan.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    // 检查 selection 内容
    const sel = await page.evaluate(() => window.getSelection()?.toString() || '')
    console.log('selection 文本:', JSON.stringify(sel))
  }
}
await page.screenshot({ path: '/tmp/fontsize0.png' })
await browser.close()
