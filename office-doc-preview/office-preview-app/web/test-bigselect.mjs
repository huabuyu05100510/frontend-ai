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

// 模拟用户：从 IT技能 区域（y≈250）拖到 工作经历 区域（y≈450）—— 跟用户截图一致
await page.mouse.move(50, 250)
await page.mouse.down()
await page.mouse.move(900, 450, { steps: 20 })
await page.mouse.up()
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/repro-big-selection.png' })
console.log('截图: 大范围拖选 /tmp/repro-big-selection.png')

// 点击空白处取消选区，再截图
await page.mouse.click(10, 10)
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/repro-after-click.png' })
console.log('截图: 点击空白后 /tmp/repro-after-click.png')

// 检查实际被选中的文本内容
const sel = await page.evaluate(() => window.getSelection()?.toString() || '')
console.log('被选中的文本长度:', sel.length, '前 50 字符:', sel.slice(0, 50))

await browser.close()
