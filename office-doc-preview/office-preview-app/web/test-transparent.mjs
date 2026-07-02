import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

await page.goto('http://localhost:5188/')
await page.waitForTimeout(3000)

// 点击第一个完成的任务
const doneCard = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (doneCard) {
  const btn = await doneCard.$('button')
  if (btn) {
    await btn.click()
    console.log('点击预览')
    await page.waitForTimeout(8000)
  }
}

// 验证 .pdf-text-layer span 的 computed color
const result = await page.evaluate(() => {
  const span = document.querySelector('.pdf-text-layer span')
  if (!span) return { found: false }
  const cs = getComputedStyle(span)
  return {
    found: true,
    text: span.textContent.slice(0, 30),
    color: cs.color,
    fontFamily: cs.fontFamily.slice(0, 50),
    fontSize: cs.fontSize,
    position: cs.position,
    backgroundColor: cs.backgroundColor
  }
})
console.log('span 计算样式:', JSON.stringify(result, null, 2))

// 拖选一段文字
const span = await page.$('.pdf-text-layer span')
if (span) {
  const box = await span.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/selection-transparent.png' })
    console.log('✓ 截图保存 /tmp/selection-transparent.png')
  }
}

await browser.close()
