/**
 * UI 回归：用 playwright 打开 demo.html，验证 >20 段能完整翻译
 *
 * 前置：node server.mjs 已起在 8787
 * 启动：node --test test/ui.e2e.test.mjs
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

test('UI: 25 段文本 → 全部翻译（修复前只能翻译 20 段）', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', m => console.log(`[browser:${m.type()}]`, m.text()))
  page.on('pageerror', e => console.log('[browser:err]', e.message))

  await page.goto(BASE)
  await page.waitForSelector('#textInput')

  // 1) 初始截图
  await page.screenshot({ path: path.join(SHOTS_DIR, '01-initial.png'), fullPage: true })

  // 2) 输入 25 段（>20 触发 bug）
  const paragraphs = Array.from({ length: 25 }, (_, i) =>
    `Paragraph number ${i + 1}: web translation is amazing technology.`
  )
  const textarea = page.locator('#textInput')
  await textarea.click()
  // 逐段输入，段间按 Enter
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) await page.keyboard.press('Enter')
    await textarea.pressSequentially(paragraphs[i], { delay: 0 })
  }

  // 调试
  const dbg = await page.$eval('#textInput', el => ({
    lines: el.value.split('\n').length,
    sample: el.value.slice(0, 60),
  }))
  console.log(`[debug] textarea 行数=${dbg.lines}, sample=${JSON.stringify(dbg.sample)}`)

  // 3) 点翻译
  await page.click('#translateTextBtn')

  // 4) 等状态变 done / error（最多 60s，因为是真 API）
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')
      return s && (s.classList.contains('done') || s.classList.contains('error'))
    },
    { timeout: 90_000 },
  )

  // 5) 截图：完成态
  await page.screenshot({ path: path.join(SHOTS_DIR, '02-after-translate.png'), fullPage: true })

  // 6) 断言：原文 25 段、译文 25 段且都有内容
  const statusText = await page.textContent('#status')
  console.log('[ui] status:', statusText)

  const srcHtml = await page.innerHTML('#sourcePane')
  const tgtHtml = await page.innerHTML('#targetPane')

  const srcCount = (srcHtml.match(/<p>/g) ?? []).length
  const tgtCount = (tgtHtml.match(/<p>/g) ?? []).length

  console.log(`[ui] 原文段数=${srcCount} 译文段数=${tgtCount}`)

  assert.equal(srcCount, 25, `原文应有 25 段，实际 ${srcCount}`)
  // 核心断言：译文段数必须 == 原文段数（修复前会是 20）
  assert.equal(tgtCount, 25, `译文应有 25 段，实际 ${tgtCount} —— 这就是 bug`)
  assert.match(statusText ?? '', /完成 25\/25 段/, '状态应显示完整段数')

  // 7) 取第 21 段译文（修复前这里是空白），验证非空
  const translations = await page.$$eval('#targetPane p', els => els.map(e => e.textContent?.trim() ?? ''))
  console.log('[ui] 第 21 段译文:', translations[20])
  console.log('[ui] 第 25 段译文:', translations[24])
  assert.notEqual(translations[20], '', '第 21 段必须有译文（修复前为空）')
  assert.notEqual(translations[24], '', '第 25 段必须有译文（修复前为空）')
})

test('UI: 切换目标语言 → 英文', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', e => console.log('[browser:err]', e.message))

  await page.goto(BASE)
  await page.selectOption('#tgtLang', 'English')
  await page.fill('#textInput', '你好，世界。这是一段测试文本。')
  await page.click('#translateTextBtn')

  await page.waitForFunction(
    () => document.getElementById('status').classList.contains('done'),
    { timeout: 30_000 },
  )

  const tgt = await page.$$eval('#targetPane p', els => els.map(e => e.textContent?.trim() ?? ''))
  console.log('[ui] 英译文:', tgt)
  assert.ok(tgt.length >= 1 && tgt[0].length > 0, '应有译文')

  await page.screenshot({ path: path.join(SHOTS_DIR, '03-english.png'), fullPage: true })
})

test('UI: 空文本 → 不报错', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(BASE)
  await page.fill('#textInput', '')
  // 直接调 click，应静默 return 不抛错
  await page.click('#translateTextBtn')
  // 等一会，确认没崩
  await new Promise(r => setTimeout(r, 500))
  const statusClass = await page.getAttribute('#status', 'class')
  assert.ok(statusClass !== 'show working' && statusClass !== 'show error', '空输入不应触发工作或错误状态')
})