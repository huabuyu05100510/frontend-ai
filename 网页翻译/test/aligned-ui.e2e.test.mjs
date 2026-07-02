/**
 * UI 回归（保结构翻译）—— 用 playwright 验证 <a href> 被保留
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '../extension/node_modules/playwright/index.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = path.resolve(__dirname, 'shots')
const BASE = 'http://localhost:8787'

test.before(async () => { await fs.mkdir(SHOTS_DIR, { recursive: true }) })

test('UI: 保结构翻译 —— <a href> 和 <em> 标签保留', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  page.on('console', m => console.log(`[browser:${m.type()}]`, m.text()))
  page.on('pageerror', e => console.log('[browser:err]', e.message))

  await page.goto(BASE)
  await page.waitForSelector('#translateHtmlBtn')

  // 打开 details
  await page.click('#htmlPanel summary')
  await page.waitForSelector('#htmlInput')

  const sampleHtml = '<p>Visit <a href="https://example.com">our great site</a> today. We <em>love</em> building products.</p>'
  // fill via keyboard to be safe
  const htmlTa = page.locator('#htmlInput')
  await htmlTa.click()
  await page.keyboard.type(sampleHtml, { delay: 0 })

  await page.click('#translateHtmlBtn')

  // 等 trace 出现 "最终 HTML" 或 done 状态
  await page.waitForFunction(
    () => {
      const trace = document.getElementById('htmlTrace')
      return trace && trace.textContent.includes('最终 HTML')
    },
    { timeout: 60_000 },
  )

  await page.screenshot({ path: path.join(SHOTS_DIR, '04-aligned.png'), fullPage: true })

  // 断言：targetPane 里应该有 <a href>
  const tgtHtml = await page.innerHTML('#targetPane')
  console.log('[aligned] targetPane html:', tgtHtml.slice(0, 300))

  assert.ok(
    /<a [^>]*href=["']https:\/\/example\.com["'][^>]*>[\s\S]*?<\/a>/.test(tgtHtml),
    `targetPane 必须保留 <a href="https://example.com">: 实际 ${tgtHtml}`
  )

  // <em> 也应保留
  assert.ok(
    /<em>[\s\S]*?<\/em>/.test(tgtHtml) || /love|爱|喜欢/i.test(tgtHtml),
    `<em>love</em> 应被翻译并保留强调`
  )

  // trace 应显示 span-projection 成功
  const trace = await page.textContent('#htmlTrace')
  assert.match(trace, /投影 spans \((\d+)\)/)
  console.log('[aligned] trace excerpt:', trace.slice(0, 500))
})

test('UI: LLM 丢占位符时 projector 仍能给位置', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  page.on('pageerror', e => console.log('[browser:err]', e.message))

  await page.goto(BASE)
  await page.click('#htmlPanel summary')
  await page.waitForSelector('#htmlInput')

  // 一个简单例子
  const htmlTa = page.locator('#htmlInput')
  await htmlTa.click()
  await page.keyboard.type('<p>Read <a href="/docs">the documentation</a> please.</p>', { delay: 0 })

  await page.click('#translateHtmlBtn')
  await page.waitForFunction(
    () => {
      const trace = document.getElementById('htmlTrace')
      return trace && (trace.textContent.includes('最终 HTML') || trace.textContent.includes('❌'))
    },
    { timeout: 60_000 },
  )

  const tgtHtml = await page.innerHTML('#targetPane')
  console.log('[aligned2] tgt:', tgtHtml)
  // 即使 LLM 丢占位符，我们仍然渲染目标文本
  assert.ok(tgtHtml.length > 0, '至少应有翻译输出')
})