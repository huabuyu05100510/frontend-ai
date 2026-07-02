/**
 * 自动化端到端：启动独立 Chrome（绕过用户已开实例）→ 加载扩展 → 翻译页面 → 截图验证
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extPath = path.resolve(__dirname, '../../dist')
const userDataDir = path.resolve(__dirname, '../../.auto-profile')

const browser = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
  ],
})

// 监听 service worker 注册
browser.on('serviceworkerattached', sw => {
  console.log('[auto] 🔥 service worker attached:', sw.url())
})

console.log('[auto] 等待扩展加载（10s）...')
await new Promise(r => setTimeout(r, 10000))

let workers = browser.serviceWorkers()
console.log(`[auto] 当前 service workers 数: ${workers.length}`)
workers.forEach(w => console.log('  -', w.url()))

if (workers.length === 0) {
  console.log('[auto] ❌ 扩展未加载')
  await browser.close()
  process.exit(1)
}

console.log('\n[auto] → 打开测试页面 https://example.com/')
const page = await browser.newPage()
const pageErrors = []
page.on('console', msg => console.log(`[page:${msg.type()}]`, msg.text().slice(0, 200)))
page.on('pageerror', err => pageErrors.push(err.message))

await page.goto('https://example.com/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

// 检查浮层
const overlay = await page.evaluate(() => {
  const host = document.getElementById('xt-status-host')
  if (!host) return null
  const text = host.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim()
  return text
})
console.log('[auto] 浮层显示:', overlay)

if (!overlay) {
  console.log('[auto] ❌ content script 未注入（浮层未出现）')
  await page.screenshot({ path: 'test/e2e/shots/no-overlay.png' })
  await browser.close()
  process.exit(1)
}

// 通过扩展的 SW 触发翻译
const sw = workers[0]
console.log('\n[auto] → 通过扩展 popup 触发翻译...')

// 找扩展 ID
const extUrl = sw.url()
const extId = extUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1]
console.log('[auto] 扩展 ID:', extId)

// 打开 popup
const popupPage = await browser.newPage()
await popupPage.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popupPage.waitForTimeout(1000)

// 填 key（虽然已硬编码，但 popup 还是要写入才能启用按钮）
const hasTranslateBtn = await popupPage.evaluate(() => {
  const btn = document.querySelector('.primary-btn')
  return !!btn && !btn.disabled
})
console.log('[auto] popup 翻译按钮可用:', hasTranslateBtn)

// 点翻译
await popupPage.click('.primary-btn').catch(e => console.log('[auto] click 失败:', e.message))
await popupPage.close()

console.log('[auto] 等待翻译完成（最多 30s）...')
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  const status = await page.evaluate(() => {
    const host = document.getElementById('xt-status-host')
    return host?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim()
  })
  const translated = await page.evaluate(() => document.querySelectorAll('[data-xt-tgt]').length)
  console.log(`  [${i + 1}s] 浮层: ${status} | 已注入: ${translated} 段`)

  if (status?.includes('完成') || translated > 0) break
}

// 最终验证
const finalState = await page.evaluate(() => ({
  overlay: document.getElementById('xt-status-host')?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim(),
  xtIdCount: document.querySelectorAll('[data-xt-id]').length,
  xtTgtCount: document.querySelectorAll('[data-xt-tgt]').length,
  firstTranslation: document.querySelector('[data-xt-tgt]')?.textContent?.slice(0, 80) ?? null,
}))
console.log('\n[auto] 最终状态:', finalState)

await page.screenshot({ path: 'test/e2e/shots/final.png', fullPage: true })
console.log('[auto] 截图保存: test/e2e/shots/final.png')

await browser.close()
process.exit(finalState.xtTgtCount > 0 ? 0 : 1)
