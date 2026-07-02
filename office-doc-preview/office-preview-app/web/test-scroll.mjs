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

// 测 frame 滚动能力
const scroll = await page.evaluate(() => {
  const root = document.querySelector('.pdf-images-root')
  const frame = document.querySelector('.pdf-images-frame')
  if (!root || !frame) return { error: 'no frame' }
  const r = frame.getBoundingClientRect()
  return {
    rootStyle: { display: getComputedStyle(root).display, height: getComputedStyle(root).height },
    frameStyle: { flex: getComputedStyle(frame).flex, overflow: getComputedStyle(frame).overflow, minHeight: getComputedStyle(frame).minHeight },
    frameBox: { w: Math.round(r.width), h: Math.round(r.height) },
    canScroll: frame.scrollHeight > frame.clientHeight,
    scrollHeight: frame.scrollHeight,
    clientHeight: frame.clientHeight
  }
})
console.log(JSON.stringify(scroll, null, 2))

// 试着滚一下
await page.evaluate(() => {
  const frame = document.querySelector('.pdf-images-frame')
  if (frame) frame.scrollTop = 500
})
await page.waitForTimeout(500)
const afterScroll = await page.evaluate(() => {
  const f = document.querySelector('.pdf-images-frame')
  return f ? f.scrollTop : -1
})
console.log('after scroll: scrollTop =', afterScroll)
await page.screenshot({ path: '/tmp/scroll-test.png' })
await browser.close()
