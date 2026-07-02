import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

await page.goto('http://localhost:5188/')
await page.waitForTimeout(3000)

const doneCard = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (doneCard) {
  const btn = await doneCard.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(8000) }
}

// 滚动到第 1 页底部（"工作经历"区域，模拟用户看到的截图）
await page.evaluate(() => {
  const root = document.querySelector('.pdf-images-root')
  if (root) root.scrollTop = 800
})
await page.waitForTimeout(2000)

// 关键：模拟"用户没拖选但 span 都有蓝色背景"的情况 → 截图看实际状态
await page.mouse.move(0, 0)  // 鼠标移开
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/repro-no-selection.png' })
console.log('截图 1: 无选区状态 /tmp/repro-no-selection.png')

// 实际选一段
const span = await page.$('.pdf-text-layer span')
if (span) {
  const box = await span.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 10, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/repro-with-selection.png' })
    console.log('截图 2: 选中状态 /tmp/repro-with-selection.png')
  }
}

await browser.close()
