/**
 * 复现用户截图：起本地服务模拟双语混排页面
 */
import { chromium } from 'playwright'
import http from 'node:http'

const extPath = '/Users/didi/Downloads/前端AI面试题/网页翻译/extension/dist'
const userDataDir = '/tmp/xt-repro-' + Date.now()

// 起一个简单 HTTP server，模拟 platform.minimaxi.com 的页面
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>套餐详情</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; background: #f5f7fa; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color: #666; font-size: 14px; margin: 0 0 24px; }
  .card { background: #fff; border: 1px solid #e0e4e8; border-radius: 8px; padding: 20px; margin: 16px 0; }
  .label { color: #444; font-size: 14px; margin: 8px 0; padding: 8px 0; }
</style>
</head>
<body>
  <h1>套餐详情</h1>
  <p class="sub">查看当前订阅状态、规格、订阅 Key 与续费管理</p>

  <div class="card">
    <p class="label">View current subscription status, specifications, subscription Key, and renewal management</p>
    <h2>订阅 Key (sk-cp)</h2>
    <p class="label">用于 Token Plan / 积分调用，不可用于按量付费</p>
    <p class="label">API keys allow you to authenticate and access our services programmatically.</p>
  </div>

  <div class="card">
    <h2>套餐用量</h2>
    <p class="label">View your current plan usage, remaining quota, and reset date.</p>
    <p class="label">当前周期：2026-06-01 至 2026-06-30</p>
  </div>

  <div class="card">
    <h2>TokenPlanMax-月度会员</h2>
    <p class="label">Subscribe to monthly membership for unlimited usage with priority access.</p>
    <p class="label">到期日 2026-06-27</p>
  </div>
</body>
</html>`)
})
await new Promise(r => srv.listen(8765, r))
console.log('[repro] HTTP server up at http://localhost:8765')

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-default-browser-check',
    '--no-first-run',
  ],
})

await new Promise(r => setTimeout(r, 8000))
const sw = browser.serviceWorkers()[0]
const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]

const page = await browser.newPage()
page.on('console', m => console.log(`[page:${m.type()}]`, m.text().slice(0, 250)))
page.on('pageerror', e => console.log('[page:err]', e.message))

await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(2500)

const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(1500)
await popup.click('.primary-btn')
await popup.close()

console.log('[repro] 等待翻译...')
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  const s = await page.evaluate(() => ({
    overlay: document.getElementById('xt-status-host')?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim(),
    ids: document.querySelectorAll('[data-xt-id]').length,
    tgt: document.querySelectorAll('[data-xt-tgt]').length,
  }))
  if (i % 2 === 0 || s.tgt > 0) console.log(`  [${i+1}s]`, s)
  if (s.tgt > 0) break
}

const details = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-xt-id]')]
  return ids.map((s, i) => {
    const src = s.textContent?.trim().slice(0, 60)
    const next = s.nextElementSibling
    const isTgt = next?.classList?.contains('xt-translation')
    const tgt = isTgt ? next.textContent?.trim().slice(0, 80) : null
    const cs = next ? getComputedStyle(next) : null
    return { idx: i + 1, src, isTgt, tgt, display: cs?.display, color: cs?.color, height: next?.offsetHeight }
  })
})
console.log('\n[repro] 每个 segment 的源/译文：')
details.forEach(d => console.log(`  #${d.idx} src="${d.src}"`))
details.forEach(d => console.log(`  #${d.idx} tgt: isTgt=${d.isTgt} text="${d.tgt}" h=${d.height}px color=${d.color}`))

await page.screenshot({ path: '/tmp/xt-repro.png', fullPage: true })
console.log('\n[repro] 截图: /tmp/xt-repro.png')
await browser.close()
srv.close()
