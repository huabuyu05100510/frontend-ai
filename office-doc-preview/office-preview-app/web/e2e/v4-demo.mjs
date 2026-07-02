// v4.0 passthrough visual demo
// 模型: claude-sonnet-4-6
import { chromium } from '@playwright/test'

const OUT = '/tmp/v4-passthrough-screenshots'
import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const page = await ctx.newPage()

// 网络日志：截获关键请求的响应头
page.on('response', resp => {
  const u = resp.url()
  if (u.includes('/api/inspect/translate')) {
    const h = resp.headers()
    console.log(`[${resp.status()}] ${u.slice(-80)}  strategy=${h['x-translate-strategy']} engine=${h['x-translate-engine']}`)
  }
})

console.log('1) 打开主页')
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' })
await page.waitForSelector('.card', { timeout: 15_000 })
await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: false })

console.log('2) 找到 DOCX 任务并打开翻译')
const docxCards = page.locator('.card:has-text(".docx")')
const n = await docxCards.count()
console.log(`   找到 ${n} 个 DOCX 任务`)
const first = docxCards.first()
const taskName = await first.locator('.card-title, .name, h3, .filename').first().textContent().catch(() => '?')
console.log(`   选择: ${taskName?.trim()}`)

const translateBtn = first.locator('button:has-text("翻译"), button:has-text("🌐")').first()
await translateBtn.click()

console.log('3) 等待检查弹层 + 切到翻译 tab')
await page.waitForSelector('[data-testid="inspect-modal"]', { timeout: 10_000 })
const tab = page.locator('[data-testid="tab-translate"]')
if (await tab.count() > 0) await tab.click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/02-inspect-modal.png` })

console.log('4) 点击 AI 翻译 → 触发 passthrough 管线')
const aiBtn = page.locator('[data-testid="translate-ai-btn"]')
if (await aiBtn.count() > 0) {
  await aiBtn.click()
} else {
  await page.locator('button:has-text("AI"), button:has-text("翻译")').first().click()
}

console.log('5) 等双栏渲染（passthrough 模式 = 右 cell 与左 cell 一致）')
await page.waitForSelector('[data-testid="translate-tgt-page-1"]', { timeout: 15_000 }).catch(() => {})
await page.waitForTimeout(2000) // 让 IntersectionObserver 触发 fetch + 渲染
await page.screenshot({ path: `${OUT}/03-translate-passthrough-full.png`, fullPage: false })

console.log('6) 截双栏并排（特写）')
const modal = page.locator('[data-testid="inspect-modal"]')
if (await modal.count() > 0) {
  await modal.screenshot({ path: `${OUT}/04-modal-closeup.png` })
}

console.log('7) 验证左右 cell img 同源')
const leftImg = page.locator('.ttl-page-row[data-page="1"] .ttl-page-cell[data-side="left"] img.ttl-page-img').first()
const rightImg = page.locator('[data-testid="translate-tgt-page-1"] img.ttl-page-img').first()
const leftCount = await leftImg.count()
const rightCount = await rightImg.count()
console.log(`   左 cell img: ${leftCount}, 右 cell img: ${rightCount}`)

if (leftCount > 0 && rightCount > 0) {
  const leftSrc = await leftImg.getAttribute('src')
  const rightSrc = await rightImg.getAttribute('src')
  console.log(`   左 src (源 PNG): ${leftSrc?.slice(0, 60)}...`)
  console.log(`   右 src (passthrough 复用源): ${rightSrc?.slice(0, 60)}...`)

  const leftSize = await leftImg.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }))
  const rightSize = await rightImg.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }))
  console.log(`   左 cell 图片尺寸: ${leftSize.w}x${leftSize.h}`)
  console.log(`   右 cell 图片尺寸: ${rightSize.w}x${rightSize.h}`)
  console.log(`   ${leftSize.w === rightSize.w && leftSize.h === rightSize.h ? '✅ 尺寸一致（passthrough = 复用源 PNG）' : '❌ 尺寸不一致'}`)

  // 单独截两张图
  await leftImg.screenshot({ path: `${OUT}/05-left-page1.png` }).catch(() => {})
  await rightImg.screenshot({ path: `${OUT}/06-right-page1.png` }).catch(() => {})
}

console.log('8) hover 右 cell 第一个 span → 联动高亮')
const firstSpan = page.locator('[data-testid="translate-tgt-page-1"] span[data-src-idx]').first()
if (await firstSpan.count() > 0) {
  const idx = await firstSpan.getAttribute('data-src-idx')
  console.log(`   hover idx=${idx}`)
  await firstSpan.hover()
  await page.waitForTimeout(300)
  const scroll = page.locator('[data-testid="translate-pages-scroll"]')
  const hovered = await scroll.getAttribute('data-hovered-src-idx').catch(() => null)
  console.log(`   容器 data-hovered-src-idx: ${hovered}  ${hovered === idx ? '✅' : '❌'}`)
  await page.screenshot({ path: `${OUT}/07-hover-sync.png` })
}

console.log('9) 验证 v6 文字层')
const v6Layer = page.locator('[data-testid="translate-tgt-page-1"] [data-pdfium="6"]')
const v6Count = await v6Layer.count()
console.log(`   v6 文字层元素数: ${v6Count}  ${v6Count > 0 ? '✅ data-pdfium="6" fullDoc charMap' : '❌'}`)

const spanCount = await page.locator('[data-testid="translate-tgt-page-1"] [data-pdfium="6"] span[data-src-idx]').count()
console.log(`   文字层 span 数: ${spanCount}  ${spanCount > 0 ? '✅ 含 global char-level spans' : '❌'}`)

await browser.close()
console.log(`\n✅ 截图已保存到 ${OUT}/`)
