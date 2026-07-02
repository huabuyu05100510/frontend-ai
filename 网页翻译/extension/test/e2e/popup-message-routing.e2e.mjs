/**
 * 端到端验证：popup 点翻译 → content 收到 → background 调 LLM → 译文注入 DOM
 */
import { chromium } from 'playwright'

const extPath = '/Users/didi/Downloads/前端AI面试题/网页翻译/extension/dist'
const userDataDir = '/tmp/xt-e2e-' + Date.now()
const BASE = 'https://example.com/'

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-default-browser-check',
    '--no-first-run',
  ],
})

console.log('[e2e] 等待扩展加载 8s...')
await new Promise(r => setTimeout(r, 8000))
const sw = browser.serviceWorkers()[0]
const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
console.log('[e2e] extId:', extId)

const page = await browser.newPage()
page.on('console', m => console.log(`[page:${m.type()}]`, m.text().slice(0, 250)))
page.on('pageerror', e => console.log('[page:err]', e.message))

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(2000)

console.log('[e2e] → 打开 popup，点 "翻译此页面"')
const popup = await browser.newPage()
popup.on('console', m => console.log(`[popup:${m.type()}]`, m.text().slice(0, 250)))
popup.on('pageerror', e => console.log('[popup:err]', e.message))
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(1500)

const btn = await popup.evaluate(() => {
  const b = document.querySelector('.primary-btn')
  return b ? { text: b.textContent.trim(), disabled: b.disabled } : null
})
console.log('[e2e] popup 按钮状态:', btn)

if (!btn || btn.disabled) {
  console.log('[e2e] ❌ 按钮不可点')
  await browser.close()
  process.exit(1)
}

await popup.click('.primary-btn')
console.log('[e2e] 已点击 "翻译此页面"')
await popup.close()

// 等翻译完成（example.com 只有 1 段 "Example Domain"）
console.log('[e2e] 等待翻译完成...')
let finalTgt = 0
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(1000)
  const s = await page.evaluate(() => ({
    overlay: document.getElementById('xt-status-host')?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim(),
    ids: document.querySelectorAll('[data-xt-id]').length,
    tgt: document.querySelectorAll('[data-xt-tgt]').length,
    firstTgt: document.querySelector('[data-xt-tgt]')?.textContent?.slice(0, 60),
  }))
  if (i % 2 === 0 || s.tgt > 0 || (s.overlay && !s.overlay.includes('已注入'))) {
    console.log(`  [${i+1}s]`, s)
  }
  if (s.tgt > 0) {
    finalTgt = s.tgt
    break
  }
}

await page.screenshot({ path: '/tmp/xt-e2e.png', fullPage: true })
console.log('[e2e] 截图: /tmp/xt-e2e.png')

await browser.close()
process.exit(finalTgt > 0 ? 0 : 1)
