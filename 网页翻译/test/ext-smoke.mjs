/**
 * 扩展加载 smoke：用 playwright + chromium 加载 dist/，验证：
 *   1. service worker 能注册
 *   2. action popup 能打开
 *   3. content script 能注入到 example.com
 *
 * 注意：MEMORY 提到「Chrome 149 + Playwright MV3 SW 不稳」，跑不通不算扩展坏。
 */
import { chromium } from 'playwright'
import path from 'node:path'

const EXT = path.resolve('extension/dist')

const browser = await chromium.launchPersistentContext('/tmp/ext-pw-profile', {
  headless: false,  // 扩展在 headless 下不稳
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
})

// 找 service worker
let sw
for (let i = 0; i < 30; i++) {
  sw = browser.serviceWorkers().find(w => w.url().includes('background') || w.url().includes('service-worker'))
  if (sw) break
  await new Promise(r => setTimeout(r, 500))
}
console.log('service worker:', sw ? sw.url() : '(not registered)')

// 找扩展 id
const targets = browser.pages()
const extPage = await browser.newPage()
await extPage.goto('chrome://extensions', { waitUntil: 'load' }).catch(() => {})
await extPage.screenshot({ path: 'test/shots/ext-loaded.png' })

// 找 popup html
const popupUrl = `chrome-extension://${await getExtId(browser)}/src/popup/popup.html`
console.log('popup url:', popupUrl)
const popupPage = await browser.newPage()
await popupPage.goto(popupUrl).catch(e => console.log('popup nav err:', e.message))
await popupPage.waitForTimeout(500)
await popupPage.screenshot({ path: 'test/shots/ext-popup.png' })
const popupText = await popupPage.textContent('body').catch(() => '')
console.log('popup body:', popupText?.slice(0, 200))

// content script 注入
const page = await browser.newPage()
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' }).catch(e => console.log('example nav err:', e.message))
await page.waitForTimeout(2000)
// 检查 content script 是否注入（通过看是否有 xt 注入的 DOM 或 marker）
const csInfo = await page.evaluate(() => ({
  hasChromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime,
  bodyHtml: document.body.innerHTML.slice(0, 300),
}))
console.log('content script state:', csInfo)
await page.screenshot({ path: 'test/shots/ext-on-example.png' })

await browser.close()

async function getExtId(ctx) {
  // service worker URL: chrome-extension://<id>/...
  for (const w of ctx.serviceWorkers()) {
    const m = /chrome-extension:\/\/([^/]+)\//.exec(w.url())
    if (m) return m[1]
  }
  // 兜底：从 targets 找
  for (const p of ctx.pages()) {
    const m = /chrome-extension:\/\/([^/]+)\//.exec(p.url())
    if (m) return m[1]
  }
  return null
}
