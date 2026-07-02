/**
 * 连接到运行中的 Chrome (CDP) → 翻译页面 → 验证
 */
import { chromium } from 'playwright'

// 通过 CDP HTTP 拿扩展 ID（connectOverCDP 不暴露 SW）
const targets = await fetch('http://localhost:9333/json/list').then(r => r.json())
const swTarget = targets.find(t => t.type === 'service_worker' && t.url.includes('chrome-extension://') && !t.url.includes('nkeim'))
let extId = swTarget?.url.match(/chrome-extension:\/\/([^/]+)/)?.[1]
console.log('[cdp] 扩展 ID:', extId, '(来源:', swTarget?.url.slice(0, 80), ')')
if (!extId) { console.log('❌ 找不到扩展 SW，扩展未加载'); process.exit(1) }

const browser = await chromium.connectOverCDP('http://localhost:9333')
console.log('[cdp] 已连接 Chrome')

const ctx = browser.contexts()[0]

console.log('\n[cdp] → 打开测试页面')
const page = await ctx.newPage()
page.on('console', msg => console.log(`  [page:${msg.type()}]`, msg.text().replace(/\n/g, ' ').slice(0, 200)))
page.on('pageerror', err => console.log(`  [page:error]`, err.message))
page.on('requestfailed', req => console.log(`  [req-fail]`, req.url(), req.failure()?.errorText))

await page.goto('http://localhost:7331/sample.html', { waitUntil: 'domcontentloaded' })
console.log('[cdp] page.url():', page.url())
console.log('[cdp] body 文本前 100:', (await page.evaluate(() => document.body?.innerText?.slice(0, 100))) ?? '<null>')
await page.waitForTimeout(2000)

const overlay = await page.evaluate(() => {
  const host = document.getElementById('xt-status-host')
  return host?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
})
console.log('[cdp] content script 浮层:', overlay)

if (!overlay) {
  console.log('[cdp] ❌ content script 没注入')
  await page.screenshot({ path: 'test/e2e/shots/no-cs.png' })
  process.exit(1)
}
console.log('[cdp] ✅ content script 已注入')

console.log('\n[cdp] → 打开 popup 触发翻译')
const popup = await ctx.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(800)

const btnInfo = await popup.evaluate(() => {
  const btn = document.querySelector('.primary-btn')
  return btn ? { disabled: btn.disabled, text: btn.textContent } : null
})
console.log('[cdp] 翻译按钮:', btnInfo)

await popup.click('.primary-btn').catch(e => console.log('[cdp] 点击失败:', e.message))
await popup.waitForTimeout(500)

console.log('\n[cdp] 等待翻译（最多 40s）...')
let final = null
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000)
  final = await page.evaluate(() => ({
    overlay: document.getElementById('xt-status-host')?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim(),
    segments: document.querySelectorAll('[data-xt-id]').length,
    translations: document.querySelectorAll('[data-xt-tgt]').length,
    firstTgt: document.querySelector('[data-xt-tgt]')?.textContent?.slice(0, 100),
    firstSrc: document.querySelector('[data-xt-id]')?.textContent?.slice(0, 100),
  }))
  if (i % 3 === 0 || final.translations > 0 || final.overlay?.includes('完成') || final.overlay?.includes('失败')) {
    console.log(`  [${i + 1}s] ${final.overlay} | segs=${final.segments} tgts=${final.translations}`)
  }
  if (final.translations > 0) break
  if (final.overlay?.includes('失败')) break
}

console.log('\n[cdp] 最终结果:')
console.log(JSON.stringify(final, null, 2))

await page.screenshot({ path: 'test/e2e/shots/result.png', fullPage: true })
console.log('\n[cdp] 截图: test/e2e/shots/result.png')

const ok = final.translations > 0
console.log(ok ? '\n🎉 端到端验证成功！' : '\n💥 翻译未生效')
process.exit(ok ? 0 : 1)
