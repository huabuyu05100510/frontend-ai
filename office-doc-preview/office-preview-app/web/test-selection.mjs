import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('console', m => console.log(`[browser ${m.type()}]`, m.text().slice(0, 200)))

await page.goto('http://localhost:5180/')
await page.waitForTimeout(2000)

// 找包含 PDF 名的卡片（用 chip 区分）
const cardNames = await page.$$eval('.card .card-name, .card-name, [class*="name"]', els => els.map(e => e.textContent))
console.log('card names:', cardNames)

// 直接用 API 上传
const uploadResp = await page.evaluate(async () => {
  const r = await fetch('http://localhost:3210/api/upload', {
    method: 'POST',
    body: (() => {
      const fd = new FormData()
      return fd
    })()
  }).catch(e => 'CORS: ' + e.message)
  return r
})
console.log('upload via fetch:', uploadResp)

// 通过 input 上传
const fileInput = await page.$('input[type=file]')
if (fileInput) {
  await fileInput.setInputFiles('/Users/huabuyu/resume/office-doc-preview/files/蘑菇书.pdf')
  console.log('已上传 PDF')
  await page.waitForTimeout(35000)
  // 刷新任务列表
  await page.reload()
  await page.waitForTimeout(2000)
  // 找新上传的卡片
  const newCards = await page.$$('.card')
  console.log(`刷新后 ${newCards.length} 个卡片`)
  // 找包含 "蘑菇" 的卡片
  const cardInfo = await page.$$eval('.card', cards => cards.map(c => ({
    name: c.querySelector('.card-name')?.textContent || c.textContent?.slice(0, 30),
    hasPreviewBtn: !!Array.from(c.querySelectorAll('button')).find(b => b.textContent.includes('预览'))
  })))
  console.log('卡片信息:', JSON.stringify(cardInfo, null, 2))
  
  // 点击第一个有预览按钮的卡片
  const btn = await page.$('.card button:has-text("预览")')
  if (btn) {
    await btn.click()
    console.log('已点击预览')
    await page.waitForTimeout(15000)
  }
}

const hasImagePage = await page.$('.pdf-image-page')
console.log('hasImagePage:', !!hasImagePage)
if (hasImagePage) {
  const info = await page.evaluate(() => {
    const p = document.querySelector('.pdf-image-page')
    const img = p.querySelector('img')
    const layer = p.querySelector('.pdf-text-layer')
    const r = p.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    const span = p.querySelector('.pdf-text-layer span')
    const sr = span ? span.getBoundingClientRect() : null
    const text = span ? span.textContent : ''
    return {
      pageBox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      imgBox: { x: Math.round(ir.x), y: Math.round(ir.y), w: Math.round(ir.width), h: Math.round(ir.height) },
      span: sr ? { text, x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) } : null
    }
  })
  console.log('布局信息:', JSON.stringify(info, null, 2))
  // 检查 img 实际尺寸和 wrapper 尺寸是否一致
  if (info) {
    const wDiff = info.pageBox.w - info.imgBox.w
    const hDiff = info.pageBox.h - info.imgBox.h
    console.log(`wrapper vs img 宽差: ${wDiff}, 高差: ${hDiff}`)
  }
}

await page.screenshot({ path: '/tmp/page-actual.png' })
await browser.close()
