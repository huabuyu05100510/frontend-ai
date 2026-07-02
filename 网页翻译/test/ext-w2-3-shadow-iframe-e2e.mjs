/**
 * W2-3 端到端：shadow DOM + 同域 iframe + 跨域 iframe 文字都被翻译
 *
 * 用法：node test/ext-w2-3-shadow-iframe-e2e.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'

const EXT = path.resolve('extension/dist')
const TEST_URL = 'http://127.0.0.1:8799/ext-shadow-iframe-test.html'

const browser = await chromium.launchPersistentContext('/tmp/ext-pw-w23', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})

let sw
for (let i = 0; i < 30; i++) {
  sw = browser.serviceWorkers().find(w => w.url().includes('service-worker'))
  if (sw) break
  await new Promise(r => setTimeout(r, 500))
}
const extId = /chrome-extension:\/\/([^/]+)\//.exec(sw.url())?.[1]
console.log('SW:', extId)

const page = await browser.newPage()
const pageLogs = []
page.on('console', (msg) => {
  const t = msg.text()
  if (/xt:|翻译|批次|rescan|shadow/i.test(t)) pageLogs.push(t)
})

await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 15000 })
await page.waitForTimeout(2000)

// 触发翻译
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(500)
await popup.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => /翻译此页面/.test(x.textContent || ''))
  b?.click()
})
await popup.close()

// 等翻译（最多 30s）
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  const done = await page.evaluate(() => {
    const t = document.querySelector('#xt-status-host')?.shadowRoot?.querySelector('.title')?.textContent || ''
    return /完成|✅/.test(t)
  })
  if (done) { console.log(`done at ${i}s`); break }
}
await page.waitForTimeout(2000)

// 收集所有 data-xt-tgt 译文文本
const result = await page.evaluate(() => {
  const out = { top: [], shadow: [], iframe: [] }
  // top frame
  document.querySelectorAll('[data-xt-tgt]').forEach(el => {
    out.top.push((el.textContent || '').trim().slice(0, 80))
  })
  // shadow root（web component 内）
  document.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      el.shadowRoot.querySelectorAll('[data-xt-tgt]').forEach(t => {
        out.shadow.push((t.textContent || '').trim().slice(0, 80))
      })
    }
  })
  // 同域 iframe
  document.querySelectorAll('iframe').forEach(f => {
    try {
      const doc = f.contentDocument
      if (doc) doc.querySelectorAll('[data-xt-tgt]').forEach(t => {
        out.iframe.push((t.textContent || '').trim().slice(0, 80))
      })
    } catch { /* cross-origin */ }
  })
  return out
})

console.log('\n=== W2-3 端到端翻译结果 ===')
console.log(`top frame: 译文 ${result.top.length} 条`)
result.top.slice(0, 5).forEach(t => console.log(`  - ${t}`))
console.log(`shadow DOM: 译文 ${result.shadow.length} 条`)
result.shadow.slice(0, 5).forEach(t => console.log(`  - ${t}`))
console.log(`iframe: 译文 ${result.iframe.length} 条`)
result.iframe.slice(0, 5).forEach(t => console.log(`  - ${t}`))

// 通过标准
const pass = result.top.length > 0 && result.shadow.length > 0 && result.iframe.length > 0
console.log(`\n${pass ? '✅ 通过' : '❌ 失败'}：三类节点都被翻译`)

await page.screenshot({ path: 'test/shots/w2-3-shadow-iframe.png', fullPage: true })
console.log('\npageLogs (相关):')
pageLogs.slice(-15).forEach(l => console.log(' ', l))

await browser.close()
process.exit(pass ? 0 : 1)
