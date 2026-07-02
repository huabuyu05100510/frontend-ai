/**
 * UI 回归：demo-aligned.html 截图 + hover 交互验证
 * 用 extension/ 已装的 playwright
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const URL = 'http://localhost:8789/demo-aligned.html'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

console.log('▶ 打开 demo...')
await page.goto(URL, { waitUntil: 'networkidle' })

// 等 cases 渲染
await page.waitForSelector('.case', { timeout: 5000 })
const caseCount = await page.locator('.case').count()
console.log(`  ✓ 渲染 ${caseCount} cases`)

// metrics 验证
const metrics = await page.locator('.metric .value').first().textContent()
console.log(`  ✓ avg F1 卡片: ${metrics}`)

// 截图：初始状态
mkdirSync('test/shots', { recursive: true })
await page.screenshot({ path: 'test/shots/demo-aligned-1-initial.png', fullPage: true })
console.log('  ✓ 截图 1: 初始')

// hover Case 2 的第一个 tgt token（我爱你 → 我）
const case2 = page.locator('.case').nth(1)
const tgtFirst = case2.locator('.tok.tgt').first()
await tgtFirst.hover()
await page.waitForTimeout(200)
await page.screenshot({ path: 'test/shots/demo-aligned-2-hover-tgt.png', fullPage: false, clip: { x: 0, y: 200, width: 1280, height: 300 } })
const hlCount = await case2.locator('.tok.hl').count()
console.log(`  ✓ hover tgt 后高亮元素数: ${hlCount}`)
if (hlCount < 2) throw new Error('hover 高亮未触发双向')

// hover Case 1 的 src 第一个
const case1 = page.locator('.case').first()
const srcFirst = case1.locator('.tok.src').first()
await srcFirst.hover()
await page.waitForTimeout(200)
const hlCount2 = await case1.locator('.tok.hl').count()
console.log(`  ✓ Case 1 hover src 后高亮元素数: ${hlCount2}`)

await page.screenshot({ path: 'test/shots/demo-aligned-3-hover-src.png', fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 350 } })

console.log('\n✓ UI 回归通过')
await browser.close()
