/**
 * 真实加载扩展 → 打开页面 → 点击「翻译此页面」→ 观察：
 *   - service worker 收到的消息
 *   - SW 日志
 *   - 页面是否注入译文
 */
import { chromium } from 'playwright'
import path from 'node:path'

const EXT = path.resolve('extension/dist')
const browser = await chromium.launchPersistentContext('/tmp/ext-pw-profile2', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
  ],
})

// 等 SW
let sw
for (let i = 0; i < 30; i++) {
  sw = browser.serviceWorkers().find(w => w.url().includes('service-worker'))
  if (sw) break
  await new Promise(r => setTimeout(r, 500))
}
if (!sw) {
  console.log('❌ service worker 没注册')
  await browser.close()
  process.exit(1)
}
const extId = /chrome-extension:\/\/([^/]+)\//.exec(sw.url())?.[1]
console.log('✅ SW:', extId)

// 监听 SW console（用 consolemessage 事件）
sw.on('consolemessage', e => {
  const t = e.text()
  if (/xt:bg|translat|deepl|error|fail/i.test(t)) console.log('[SW]', t.slice(0, 250))
})

// 监听 SW console
sw.on('consolemessage', e => console.log(`[SW:${e.type()}]`, e.text().slice(0, 250)))

// 打开测试页
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push('PAGE-ERR: ' + e.message))
page.on('console', m => {
  const t = m.text()
  if (/xt:|translat|align|error/i.test(t)) console.log('[PAGE]', t.slice(0, 200))
})

console.log('--- 打开 BBC ---')
await page.goto('https://www.bbc.com/news', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('nav err', e.message))
await page.waitForTimeout(3000)

// 打开 popup 触发翻译（popup 是用户点击的入口）
console.log('--- 打开 popup 点翻译 ---')
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(500)

// 找翻译按钮
const buttons = await popup.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map(b => ({ text: b.textContent?.trim(), id: b.id, cls: b.className }))
)
console.log('popup buttons:', JSON.stringify(buttons, null, 2))

// 截图 popup 当前状态
await popup.screenshot({ path: 'test/shots/ext-popup-before-translate.png' })

// 点击「翻译此页面」
const clicked = await popup.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'))
  const t = btns.find(b => /翻译此页面|Translate/i.test(b.textContent || ''))
  if (t) { t.click(); return t.textContent?.trim() }
  return null
})
console.log('clicked:', clicked)

// 等 90s 看翻译进度
console.log('--- 等待翻译 (90s) ---')
let lastLine = ''
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000)
  const result = await page.evaluate(() => {
    const m = (document.body.textContent || '').match(/(\d+)\s*\/\s*(\d+)/)
    return {
      progress: m ? m[0] : null,
      injected: document.querySelectorAll('[data-xt-tgt], .xt-translation, [data-xt]').length,
      pendingAttr: document.querySelectorAll('[data-xt-pending]').length,
    }
  })
  const line = `[${i}s] progress=${result.progress} injected=${result.injected} pending=${result.pendingAttr}`
  if (line !== lastLine) {
    console.log(line)
    lastLine = line
  }
  if (result.injected > 140) { console.log('✅ 注入 > 140 段（接近全部），bug 已修'); break }
}

await page.screenshot({ path: 'test/shots/ext-bbc-result.png', fullPage: false })
console.log('=== PAGE ERRORS ===')
for (const e of errors.slice(0, 20)) console.log(e)

await browser.close()
