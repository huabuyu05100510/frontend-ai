import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:5188/')
await page.waitForTimeout(3000)

// 找最新转码的 docx 任务
const tasks = await page.$$eval('.card', cards => cards.map(c => ({
  name: c.querySelector('.card-name')?.textContent || '',
  hasBtn: !!Array.from(c.querySelectorAll('button')).find(b => b.textContent.includes('预览'))
})))
console.log('任务列表（前 3 个）:', tasks.slice(0, 3))

const card = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (card) {
  const btn = await card.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(8000) }
}

// 验证 span 高度是新算法的（height ≈ 33.62 for 郭亚平）
const spanInfo = await page.evaluate(() => {
  const spans = document.querySelectorAll('.pdf-text-layer span')
  const result = []
  for (let i = 0; i < Math.min(5, spans.length); i++) {
    const s = spans[i]
    result.push({ text: s.textContent.slice(0, 20), top: s.style.top, height: s.style.height, width: s.style.width })
  }
  return result
})
console.log('\n=== 新算法 span（前 5）===')
console.log(JSON.stringify(spanInfo, null, 2))

// 测 PNG 实际 ink 边界
const { execSync } = await import('node:child_process')
const { default: sharp } = await import('sharp').catch(() => ({ default: null }))
// 不依赖 sharp，用 Image
const imgCheck = await page.evaluate(() => {
  const img = document.querySelector('img.pdf-images-page')
  if (!img) return null
  return { src: img.src, complete: img.complete, w: img.naturalWidth, h: img.naturalHeight }
})
console.log('\n=== PNG 加载状态 ===')
console.log(JSON.stringify(imgCheck, null, 2))

// 模拟用户拖选一段 + 截图
const span = await page.$('.pdf-text-layer span')
if (span) {
  const box = await span.boundingBox()
  if (box) {
    // 拖选 "郭亚平"
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/new-selection.png' })
    console.log('\n截图保存 /tmp/new-selection.png')
  }
}
await browser.close()
