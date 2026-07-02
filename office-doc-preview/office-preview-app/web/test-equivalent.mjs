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
// 截跟用户一样的位置（"郭亚平"区域）
await page.evaluate(() => {
  const root = document.querySelector('.pdf-images-root')
  if (root) root.scrollTop = 0
})
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/equivalent-user.png' })
await browser.close()
