/**
 * 用 launchPersistentContext 直接启动 Chrome 加载扩展 + 翻译页面
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extPath = path.resolve(__dirname, '../../dist')
const userDataDir = path.resolve(__dirname, '../../.auto-profile')

console.log('[run] 扩展路径:', extPath)
console.log('[run] user-data-dir:', userDataDir)

const browser = await chromium.launchPersistentContext(userDataDir, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-popup-blocking',
  ],
})

browser.on('serviceworkerattached', sw => {
  console.log('[run] 🔥 SW attached:', sw.url().slice(0, 100))
})
browser.on('backgroundpage', pg => {
  console.log('[run] bg page:', pg.url())
})

// 等待 SW 注册（最多 20s）
let workers = []
for (let i = 0; i < 20; i++) {
  workers = browser.serviceWorkers()
  if (workers.length > 0) break
  await new Promise(r => setTimeout(r, 1000))
  if (i % 3 === 0) console.log(`[run] [${i}s] 等 SW...`)
}
console.log(`[run] SW 数: ${workers.length}`)
workers.forEach(w => console.log('  -', w.url()))

if (workers.length === 0) {
  console.log('[run] ❌ 扩展未加载')
  await browser.close()
  process.exit(1)
}

const extId = workers[0].url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
console.log('[run] 扩展 ID:', extId)

console.log('\n[run] → 打开测试页面 http://localhost:7331/sample.html')
const page = await browser.newPage()
page.on('console', msg => console.log(`  [page:${msg.type()}]`, msg.text().replace(/\n/g, ' ').slice(0, 200)))
page.on('pageerror', err => console.log(`  [page:error]`, err.message))

await page.goto('http://localhost:7331/sample.html', { waitUntil: 'domcontentloaded' })
console.log('[run] page.url():', page.url())
await page.waitForTimeout(3000)

const overlay = await page.evaluate(() => {
  const host = document.getElementById('xt-status-host')
  return host?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
})
console.log('[run] content script 浮层:', overlay)

if (!overlay) {
  console.log('[run] ❌ content script 未注入')
  // 直接检查 chrome 对象
  const probe = await page.evaluate(() => ({
    hasChrome: typeof chrome !== 'undefined',
    hasRuntime: typeof chrome !== 'undefined' && !!chrome.runtime,
    runtimeId: typeof chrome !== 'undefined' && chrome.runtime?.id,
  }))
  console.log('[run] chrome 探针:', probe)
  await page.screenshot({ path: 'test/e2e/shots/no-cs.png' })
  await browser.close()
  process.exit(1)
}

console.log('[run] ✅ content script 已注入')

console.log('\n[run] → 通过 popup 触发翻译')
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(800)

const btnInfo = await popup.evaluate(() => {
  const btn = document.querySelector('.primary-btn')
  return btn ? { disabled: btn.disabled, text: btn.textContent } : null
})
console.log('[run] 翻译按钮:', btnInfo)

await popup.click('.primary-btn').catch(e => console.log('[run] 点击失败:', e.message))

console.log('\n[run] 等待翻译（最多 60s）...')
let final = null
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  final = await page.evaluate(() => ({
    overlay: document.getElementById('xt-status-host')?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim(),
    segments: document.querySelectorAll('[data-xt-id]').length,
    translations: document.querySelectorAll('[data-xt-tgt]').length,
    firstTgt: document.querySelector('[data-xt-tgt]')?.textContent?.slice(0, 100),
    firstSrc: document.querySelector('[data-xt-id]')?.textContent?.slice(0, 100),
  }))
  if (i % 3 === 0 || final.translations > 0 || (final.overlay && (final.overlay.includes('完成') || final.overlay.includes('失败')))) {
    console.log(`  [${i + 1}s] ${final.overlay} | segs=${final.segments} tgts=${final.translations}`)
  }
  if (final.translations > 0) break
  if (final.overlay?.includes('失败')) break
}

console.log('\n[run] 最终:')
console.log(JSON.stringify(final, null, 2))

await page.screenshot({ path: 'test/e2e/shots/result.png', fullPage: true })
console.log('\n[run] 截图: test/e2e/shots/result.png')

const ok = final.translations > 0
console.log(ok ? '\n🎉 端到端 OK' : '\n💥 翻译未生效')
await browser.close()
process.exit(ok ? 0 : 1)
