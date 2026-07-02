// v4.1 端到端 + 视觉回归
// 模型: claude-sonnet-4-6
//
// 验证：
//   1. 主页 → DOCX 任务 → AI 翻译
//   2. 译文第一页内容（meta.sourceChars > 0）
//   3. 默认 zoom 自适应容器宽度（左右 cell 同屏可见）
//   4. hover 右 cell span → 容器 data-hovered-src-idx 同步
//   5. 复制双语 → ClipboardItem 含 text/html (table) + text/plain
//   6. 截图存到 /tmp/v4.1-screenshots/

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = '/tmp/v4.1-screenshots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
// 1280 视口（更窄，验证 fit-width 真的 work）
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()

const errs = []
page.on('pageerror', e => errs.push(`pageerror: ${e.message}`))
page.on('console', m => {
  if (m.type() === 'error') errs.push(`console.error: ${m.text()}`)
})

// 网络日志
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
await page.screenshot({ path: `${OUT}/01-home.png` })

console.log('2) 找到 DOCX 任务 → 打开翻译')
const docxCards = page.locator('.card:has-text(".docx")')
const n = await docxCards.count()
console.log(`   找到 ${n} 个 DOCX 任务`)
const first = docxCards.first()
const translateBtn = first.locator('button:has-text("翻译"), button:has-text("🌐")').first()
await translateBtn.click()

await page.waitForSelector('[data-testid="inspect-modal"]', { timeout: 10_000 })
const tab = page.locator('[data-testid="tab-translate"]')
if (await tab.count() > 0) await tab.click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/02-modal-empty.png` })

console.log('3) 点击 AI 翻译 → 触发 passthrough')
const aiBtn = page.locator('[data-testid="translate-ai-btn"]')
if (await aiBtn.count() > 0) {
  await aiBtn.click()
} else {
  await page.locator('button:has-text("AI")').first().click()
}

console.log('4) 等双栏渲染')
await page.waitForSelector('[data-testid="translate-tgt-page-1"]', { timeout: 15_000 }).catch(() => {})
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/03-translate-passthrough.png` })

console.log('5) 验证 meta.sourceChars > 0（修复 译文第一页不对）')
const footer = page.locator('[data-testid="translate-footer"]')
const footerText = await footer.textContent()
console.log(`   footer: ${footerText?.replace(/\s+/g, ' ').trim()}`)
const hasChars = /原文\s*([1-9]\d*)\s*字符/.test(footerText || '')
console.log(`   ${hasChars ? '✅' : '❌'} 原文字符数 > 0`)

console.log('6) 验证默认 zoom 自适应（修复 滚动没有联动）')
const zoomLabel = page.locator('[data-testid="translate-zoom"]')
const zoomText = await zoomLabel.textContent()
const scale = Number(zoomText?.replace('%', '')) / 100
console.log(`   当前 zoom: ${zoomText} (scale=${scale})`)
// 视口 1280，pageW=991 → 期望 scale ≈ 0.61
if (scale >= 0.5 && scale <= 0.75) {
  console.log(`   ✅ 默认 zoom 自适应（左右 cell 同屏可见）`)
} else {
  console.log(`   ❌ zoom 异常（应在 0.5-0.75 之间）`)
}

// 验证左 cell 和右 cell 都可见
const leftCell = page.locator('.ttl-page-row[data-page="1"] .ttl-page-cell[data-side="left"]').first()
const rightCell = page.locator('.ttl-page-row[data-page="1"] .ttl-page-cell[data-side="right"]').first()
const leftBox = await leftCell.boundingBox()
const rightBox = await rightCell.boundingBox()
console.log(`   左 cell 位置: x=${leftBox?.x.toFixed(0)} w=${leftBox?.width.toFixed(0)}`)
console.log(`   右 cell 位置: x=${rightBox?.x.toFixed(0)} w=${rightBox?.width.toFixed(0)}`)
if (rightBox && rightBox.x + rightBox.width <= 1280) {
  console.log(`   ✅ 右 cell 完整可见（无需横向滚动）`)
} else {
  console.log(`   ⚠️ 右 cell 仍需横向滚动`)
}

console.log('7) 验证 hover 联动（修复 hover 联动）')
// 等右 cell 文字层加载
await page.waitForSelector('[data-testid="translate-tgt-page-1"] span[data-src-idx]', { timeout: 10_000 })
const spanCount = await page.locator('[data-testid="translate-tgt-page-1"] span[data-src-idx]').count()
console.log(`   右 cell 文字层 span 数: ${spanCount}  ${spanCount > 100 ? '✅' : '❌'}`)

if (spanCount > 0) {
  const firstSpan = page.locator('[data-testid="translate-tgt-page-1"] span[data-src-idx]').first()
  const idx = await firstSpan.getAttribute('data-src-idx')
  console.log(`   hover 第 1 个 span (data-src-idx=${idx})`)
  await firstSpan.hover()
  await page.waitForTimeout(300)
  const scroll = page.locator('[data-testid="translate-pages-scroll"]')
  const hovered = await scroll.getAttribute('data-hovered-src-idx')
  console.log(`   容器 data-hovered-src-idx: ${hovered}  ${hovered === idx ? '✅' : '❌'}`)

  // 验证 span 自己也获得了 .is-hover class
  const hasHoverClass = await firstSpan.evaluate(el => el.classList.contains('is-hover'))
  console.log(`   span.is-hover class: ${hasHoverClass ? '✅' : '❌'}`)

  await page.screenshot({ path: `${OUT}/04-hover-sync.png` })
}

console.log('8) 验证复制双语（修复 复制联动）')
const copyBilingual = page.locator('[data-testid="translate-copy-bilingual"]')
if (await copyBilingual.count() > 0) {
  await copyBilingual.click()
  await page.waitForTimeout(500)
  // 读剪贴板
  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const out = {}
    for (const it of items) {
      for (const t of it.types) {
        const blob = await it.getType(t)
        out[t] = await blob.text()
      }
    }
    return out
  })
  const hasTable = clip['text/html']?.includes('<table')
  const hasRows = clip['text/html']?.includes('<td>')
  const hasPlain = clip['text/plain']?.length > 0
  console.log(`   text/html 含 <table>: ${hasTable ? '✅' : '❌'}`)
  console.log(`   text/html 含 <td>: ${hasRows ? '✅' : '❌'}`)
  console.log(`   text/plain 长度: ${clip['text/plain']?.length || 0} ${hasPlain ? '✅' : '❌'}`)
  if (hasTable && hasRows && hasPlain) {
    console.log(`   ✅ 复制双语 OK（HTML 表格 + 纯文本）`)
  } else {
    console.log(`   ❌ 复制双语失败`)
    console.log(`   text/html preview: ${clip['text/html']?.slice(0, 200)}`)
    console.log(`   text/plain preview: ${clip['text/plain']?.slice(0, 100)}`)
  }
}

console.log('9) 验证复制原文')
const copySource = page.locator('[data-testid="translate-copy-source"]')
if (await copySource.count() > 0) {
  await copySource.click()
  await page.waitForTimeout(300)
  const srcClip = await page.evaluate(async () => {
    return await navigator.clipboard.readText()
  })
  console.log(`   复制原文长度: ${srcClip.length} ${srcClip.length > 100 ? '✅' : '❌'}`)
  console.log(`   预览: ${srcClip.slice(0, 100)}...`)
}

console.log('10) 验证点「适应宽度」按钮')
const fitBtn = page.locator('[data-testid="translate-fit-width"]')
if (await fitBtn.count() > 0) {
  // 先放大
  const zoomIn = page.locator('button[aria-label="放大"]')
  for (let i = 0; i < 5; i++) await zoomIn.click()
  const bigZoom = await page.locator('[data-testid="translate-zoom"]').textContent()
  console.log(`   放大后 zoom: ${bigZoom}`)
  // 再 fit
  await fitBtn.click()
  await page.waitForTimeout(200)
  const fitZoom = await page.locator('[data-testid="translate-zoom"]').textContent()
  console.log(`   fit-width 后 zoom: ${fitZoom}  ${fitZoom === zoomText ? '✅' : '❌'}`)
}

console.log('11) 翻页（验证 pager + 滚动同步）')
const thumb2 = page.locator('[data-testid="thumb-2"]')
if (await thumb2.count() > 0) {
  await thumb2.click()
  await page.waitForTimeout(800)
  const pagerInfo = await page.locator('[data-testid="translate-pager-info"]').textContent()
  console.log(`   翻到第 2 页后 pager: ${pagerInfo}`)
  await page.screenshot({ path: `${OUT}/05-page2.png` })
  // 翻回第 1 页
  const thumb1 = page.locator('[data-testid="thumb-1"]')
  await thumb1.click()
  await page.waitForTimeout(800)
}

console.log('12) 最终全屏截图')
await page.screenshot({ path: `${OUT}/06-final.png`, fullPage: false })

console.log('')
console.log('=== JS 错误 ===')
if (errs.length === 0) {
  console.log('  无错误')
} else {
  errs.forEach(e => console.log('  ' + e))
}

await browser.close()
console.log(`\n✅ 截图保存到 ${OUT}/`)
