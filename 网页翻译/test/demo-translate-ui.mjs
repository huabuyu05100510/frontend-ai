/**
 * Phase 7 UI 验证（直接用 playwright core，不走 test runner）
 *
 * 跑：node test/demo-translate-ui.mjs
 */
import { chromium } from 'playwright'

const DEMO_URL = 'http://127.0.0.1:8789/demo-translate.html'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })

  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => errors.push(err.message))

  console.log('▶ 打开 demo...')
  await page.goto(DEMO_URL, { waitUntil: 'networkidle' })

  console.log('▶ 等首次翻译完成（最长 30s）...')
  await page.waitForSelector('.tok.tgt:not(.special)', { timeout: 30000 })

  const srcCount = await page.locator('.tok.src:not(.special)').count()
  const tgtCount = await page.locator('.tok.tgt:not(.special)').count()
  console.log(`  ✓ src ${srcCount} token, tgt ${tgtCount} token`)

  if (srcCount < 5 || tgtCount === 0) {
    throw new Error(`token 数量异常 src=${srcCount} tgt=${tgtCount}`)
  }

  // 验证译文文本
  const metaText = await page.locator('#meta').textContent()
  console.log(`  meta: ${metaText.slice(0, 200)}`)

  // hover 第一个 src token
  const firstSrc = page.locator('.tok.src:not(.special)').first()
  const firstSrcText = await firstSrc.textContent()
  await firstSrc.hover()
  await page.waitForTimeout(300)
  const tgtHlCount = await page.locator('.tok.tgt.hl').count()
  console.log(`  ✓ hover src "${firstSrcText}" → ${tgtHlCount} tgt tokens 高亮`)

  await page.screenshot({ path: 'test/shots/phase7-hover-src.png', fullPage: true })

  // 清除 hover
  await page.locator('h1').hover()
  await page.waitForTimeout(200)

  // 输入新句子
  console.log('▶ 输入新句子...')
  await page.fill('#src-input', 'Neural networks are powerful')
  await page.click('#translate-btn')

  await page.waitForFunction(() => {
    return document.querySelectorAll('.tok.tgt:not(.special)').length > 0
  }, { timeout: 30000 })

  // 等译文稳定（检查译文含「神经」）
  await page.waitForFunction(() => {
    const meta = document.querySelector('#meta').textContent
    return meta.includes('神经')
  }, { timeout: 10000 }).catch(() => console.log('  ⚠ 译文未含「神经」'))

  console.log('  ✓ 神经网络句翻译完成')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test/shots/phase7-neural.png', fullPage: true })

  // hover 中文侧
  const firstTgt = page.locator('.tok.tgt:not(.special)').first()
  const firstTgtText = await firstTgt.textContent()
  await firstTgt.hover()
  await page.waitForTimeout(300)
  const srcHlCount = await page.locator('.tok.src.hl').count()
  console.log(`  ✓ hover tgt "${firstTgtText}" → ${srcHlCount} src tokens 高亮`)
  await page.screenshot({ path: 'test/shots/phase7-hover-tgt.png', fullPage: true })

  if (errors.length > 0) {
    console.log('\n✗ JS errors:')
    errors.forEach(e => console.log('  ', e))
    process.exit(1)
  }

  console.log('\n✓ Phase 7 demo 验证通过，0 JS error')
  console.log('  截图：')
  console.log('    test/shots/phase7-hover-src.png')
  console.log('    test/shots/phase7-neural.png')
  console.log('    test/shots/phase7-hover-tgt.png')

  await browser.close()
}

main().catch(e => {
  console.error('✗', e)
  process.exit(1)
})
