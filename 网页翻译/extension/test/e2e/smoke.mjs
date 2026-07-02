// 端到端冒烟测试：启动 Chrome 加载扩展，验证翻译真的生效
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extPath = path.resolve(__dirname, '../../dist')

const extId = 'extensionsmoketest'

const userDataDir = path.resolve(__dirname, '../../.smoke-profile')

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  channel: 'chrome',
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-default-browser-check',
    '--no-first-run',
  ],
})

// 等待 service worker 注册
await new Promise(r => setTimeout(r, 4000))
const workers = browser.serviceWorkers()
console.log('[smoke] service workers:', workers.map(w => w.url()))
const sw = workers[0]
if (!sw) console.warn('[smoke] ⚠ 没找到 service worker，扩展可能没加载')

// 打开测试页面
const page = await browser.newPage()
page.on('console', msg => console.log(`[page:${msg.type()}]`, msg.text()))

await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

// 检查 content script 是否注入
const injected = await page.evaluate(() => {
  return {
    hasContentScript: typeof chrome !== 'undefined' && !!chrome.runtime?.id,
    bodyHasDataAttrs: document.querySelectorAll('[data-xt-id]').length,
  }
})
console.log('[smoke] 注入状态:', injected)

// 直接通过 chrome.tabs.sendMessage 触发翻译
await page.evaluate(async () => {
  // 模拟 popup 发 TRANSLATE 消息
  chrome.runtime.sendMessage({ type: 'TRANSLATE', srcLang: 'auto', tgtLang: 'zh', mode: 'bilingual' })
})

console.log('[smoke] 翻译指令已发，等 15s...')
await page.waitForTimeout(15000)

const after = await page.evaluate(() => ({
  xtIdCount: document.querySelectorAll('[data-xt-id]').length,
  xtTgtCount: document.querySelectorAll('[data-xt-tgt]').length,
  firstTranslation: document.querySelector('[data-xt-tgt]')?.textContent?.slice(0, 80) ?? null,
}))
console.log('[smoke] 翻译后:', after)

await browser.close()
process.exit(0)
