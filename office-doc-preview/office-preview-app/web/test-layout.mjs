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

const layout = await page.evaluate(() => {
  const frame = document.querySelector('.pdf-images-frame')
  const pages = document.querySelectorAll('.pdf-image-page')
  if (!frame || !pages.length) return { error: 'no elements' }
  const fr = frame.getBoundingClientRect()
  const fcs = getComputedStyle(frame)
  return {
    frame: { w: Math.round(fr.width), h: Math.round(fr.height), x: Math.round(fr.x), y: Math.round(fr.y), overflow: fcs.overflow, alignItems: fcs.alignItems, display: fcs.display, flexDirection: fcs.flexDirection },
    pageCount: pages.length,
    pages: Array.from(pages).slice(0, 4).map((p, i) => {
      const r = p.getBoundingClientRect()
      return { i, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }
    })
  }
})
console.log(JSON.stringify(layout, null, 2))
await page.screenshot({ path: '/tmp/layout-test.png' })
await browser.close()
