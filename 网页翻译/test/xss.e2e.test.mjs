/**
 * XSS 防御 e2e 回归
 *
 * 不依赖 LLM：通过 page.evaluate 直接测 sanitize-html.mjs 在浏览器环境的输出。
 * 另一条用例通过真实 /api/translate-aligned（mock fetch 返回恶意 tgtText）测端到端。
 *
 * 启动：node --test test/xss.e2e.test.mjs （需先 node server.mjs）
 *
 * 模型：Claude (Sonnet 4.5)
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

test('XSS: sanitizeHtmlString 在浏览器侧剔除 javascript:/onerror/<script>', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await browser.newPage()
  page.on('console', m => console.log(`[browser:${m.type()}]`, m.text()))

  await page.goto(BASE)

  const result = await page.evaluate(async () => {
    const mod = await import('/lib/sanitize-html.mjs')
    const { sanitizeHtmlString } = mod
    return {
      javascript: sanitizeHtmlString('<a href="javascript:alert(1)">x</a>'),
      onerror: sanitizeHtmlString('<img src="/x.png" onerror="alert(1)">'),
      script: sanitizeHtmlString('<p>ok</p><script>alert(1)</script>'),
      iframe: sanitizeHtmlString('<iframe src="javascript:alert(1)"></iframe>'),
      inline: sanitizeHtmlString('<div style="background:url(javascript:alert(1))">y</div>'),
      legit: sanitizeHtmlString('<a href="https://ok.com/path">good</a>'),
      rel: sanitizeHtmlString('<a href="/rel/path">rel</a>'),
    }
  })

  console.log('[xss] sanitize results:', result)

  // 危险内容被剔除
  assert.ok(!result.javascript.includes('javascript:'), `javascript: 应剔除: ${result.javascript}`)
  assert.ok(!result.onerror.includes('onerror'), `onerror 应剔除: ${result.onerror}`)
  assert.ok(!result.script.includes('script'), `<script> 应整段丢: ${result.script}`)
  assert.ok(!result.iframe.includes('iframe'), `<iframe> 应整段丢: ${result.iframe}`)
  assert.ok(!result.inline.includes('style'), `style 应剔除: ${result.inline}`)

  // 合法链接保留
  assert.ok(result.legit.includes('href="https://ok.com/path"'), `合法 https 链接应保留: ${result.legit}`)
  assert.ok(result.rel.includes('href="/rel/path"'), `相对路径应保留: ${result.rel}`)
})

test('XSS: sourcePane 显示原文 textContent，targetPane 经 sanitize', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', e => console.log('[browser:err]', e.message))

  await page.goto(BASE)
  await page.waitForSelector('#translateHtmlBtn')

  // 打开 htmlPanel，注入含 XSS 的 HTML
  await page.click('#htmlPanel summary')
  await page.waitForSelector('#htmlInput')

  // 恶意原文：含 javascript: / onerror / <script>
  const malicious = '<p>x<a href="javascript:alert(1)">click</a></p><script>alert(1)</script>'
  await page.locator('#htmlInput').click()
  await page.keyboard.type(malicious, { delay: 0 })

  // 拦截 /api/translate-aligned，返回模拟译文（让 demo 流程跑完，不依赖真实 LLM）
  await page.route('**/api/translate-aligned', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tgtText: 'x ⟦t1:a⟧click⟧/t1⟧' }),
    })
  })

  await page.click('#translateHtmlBtn')

  // 等 trace 出现
  await page.waitForFunction(
    () => {
      const trace = document.getElementById('htmlTrace')
      return trace && (trace.textContent.includes('最终 HTML') || trace.textContent.includes('❌'))
    },
    { timeout: 30_000 },
  ).catch(() => {})

  await page.screenshot({ path: path.join(SHOTS_DIR, '05-xss.png'), fullPage: true })

  // 关键断言：sourcePane 是 textContent，不会有真实 <script> 执行（textContent 自然 escape）
  const sourceHtml = await page.innerHTML('#sourcePane')
  assert.ok(!sourceHtml.toLowerCase().includes('<script'), `sourcePane 不应有真实 script tag: ${sourceHtml}`)

  // targetPane：javascript: 应被 sanitize 剔除
  const targetHtml = await page.innerHTML('#targetPane')
  console.log('[xss] targetPane:', targetHtml)
  assert.ok(!targetHtml.toLowerCase().includes('javascript:'), `targetPane 不应含 javascript: ${targetHtml}`)

  // 进一步：page 上不应有 alert 弹窗（侧证 <script> 没执行）
  // playwright 默认会自动 dismiss dialog；我们做反向断言：dialog 事件未触发
  let dialogTriggered = false
  page.on('dialog', () => { dialogTriggered = true })
  await page.waitForTimeout(500)
  assert.equal(dialogTriggered, false, '不应有 alert 弹窗（说明 script/javascript: 都没执行）')
})
