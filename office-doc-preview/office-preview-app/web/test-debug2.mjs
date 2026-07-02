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

const debug = await page.evaluate(() => {
  const wrapper = document.querySelector('.pdf-image-page')
  const img = document.querySelector('img.pdf-images-page')
  const layer = document.querySelector('.pdf-text-layer')
  const span = document.querySelector('.pdf-text-layer span')
  
  const ics = getComputedStyle(img)
  const lcs = layer ? getComputedStyle(layer) : null
  const scs = span ? getComputedStyle(span) : null
  
  // 检查元素在 DOM 树里的位置
  const children = Array.from(wrapper.children).map(c => ({
    tag: c.tagName,
    class: c.className,
    rect: (() => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()
  }))
  
  return {
    img: { zIndex: ics.zIndex, position: ics.position, opacity: ics.opacity, visibility: ics.visibility, display: ics.display },
    layer: lcs ? { zIndex: lcs.zIndex, position: lcs.position, color: lcs.color, opacity: lcs.opacity, visibility: lcs.visibility, display: lcs.display, bg: lcs.backgroundColor } : null,
    span: scs ? { zIndex: scs.zIndex, position: scs.position, color: scs.color, fontSize: scs.fontSize, fontFamily: scs.fontFamily, bg: scs.backgroundColor, opacity: scs.opacity } : null,
    children
  }
})
console.log(JSON.stringify(debug, null, 2))
await browser.close()
