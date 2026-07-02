import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:5188/')
await page.waitForTimeout(3000)
const card = await page.$('.card:has-text("郭亚平_前端_03(1).docx")')
if (card) {
  const btn = await card.$('button')
  if (btn) { await btn.click(); await page.waitForTimeout(5000) }
}

const cssCheck = await page.evaluate(async () => {
  const r = await fetch('/src/styles.css')
  const text = await r.text()
  return {
    status: r.status,
    length: text.length,
    hasPdfImagesRoot: text.includes('pdf-images-root'),
    hasPdfImagesFrame: text.includes('pdf-images-frame'),
    hasPdfTextLayer: text.includes('pdf-text-layer'),
    hasTransparent: text.includes('color: transparent'),
    backgroundCount: (text.match(/background:/g) || []).length
  }
})
console.log('CSS fetch:', JSON.stringify(cssCheck, null, 2))
await browser.close()
