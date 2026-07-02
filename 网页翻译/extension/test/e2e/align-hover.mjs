/**
 * W1-5 e2e：扩展 + LaBSE 对齐服务全链路 hover 验证
 *
 * 前置：
 *   1. node server/labse_server.mjs（已在跑）
 *   2. cd extension && npm run build
 *
 * 流程：
 *   启动 Chrome → 加载扩展 → 打开本地测试页 → 翻译 → 等待对齐 → hover → 截图断言
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extPath = path.resolve(__dirname, '../../dist')
const userDataDir = path.resolve(__dirname, '../../.align-profile-' + Date.now())

// ─── 起一个本地静态测试页（避免外网抖动）────────────────────
const TEST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>align test</title>
<style>body{font:16px/1.6 -apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px}</style>
</head><body>
<h1>I love you</h1>
<p>The quick brown fox jumps over the lazy dog.</p>
<p>Machine learning models require large datasets to train effectively.</p>
</body></html>`

const PORT = 9966
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(TEST_HTML)
})
await new Promise(r => server.listen(PORT, r))
console.log(`[e2e] test page: http://localhost:${PORT}`)

// 预检 LaBSE 服务
try {
  const r = await fetch('http://127.0.0.1:8788/health')
  const j = await r.json()
  if (!j.ok) throw new Error('labse server not ready')
  console.log('[e2e] LaBSE server ok:', j)
} catch (e) {
  console.error('[e2e] ✗ LaBSE 服务未启动，请先跑: node server/labse_server.mjs')
  server.close()
  process.exit(1)
}

// ─── 启动 Chrome + 扩展 ─────────────────────────────────────
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

console.log('[e2e] 等待扩展加载...')
let workers = []
const swReady = new Promise(resolve => {
  browser.on('serviceworkerattached', sw => {
    console.log('[e2e] 🔥 SW attached:', sw.url())
    resolve()
  })
})
// 同时轮询，二选一满足
for (let i = 0; i < 30; i++) {
  workers = browser.serviceWorkers()
  if (workers.length > 0) break
  await Promise.race([swReady, new Promise(r => setTimeout(r, 1000))])
  workers = browser.serviceWorkers()
  if (workers.length > 0) break
  console.log(`  [${i + 1}s] SW still not attached...`)
}
if (workers.length === 0) {
  console.error('[e2e] ❌ 扩展未加载')
  await browser.close()
  server.close()
  process.exit(1)
}
const extId = workers[0].url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
console.log('[e2e] 扩展 ID:', extId)

const page = await browser.newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[xt:') || t.includes('xt:')) console.log(`  [page] ${t.slice(0, 200)}`)
})

await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

// 触发翻译（直接走 popup 路径）
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(500)
await popup.click('.primary-btn').catch(() => {})
await popup.close()

console.log('[e2e] 等待翻译 + 对齐完成（最多 60s）...')
let aligned = 0
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  aligned = await page.evaluate(() => document.querySelectorAll('[data-xt-tok="tgt"]').length)
  const tgtCount = await page.evaluate(() => document.querySelectorAll('[data-xt-tgt]').length)
  console.log(`  [${i + 1}s] tgt 段=${tgtCount}, aligned tokens=${aligned}`)
  if (aligned > 0 && tgtCount >= 3) break
}

if (aligned === 0) {
  console.error('[e2e] ❌ 没有对齐 token span 出现')
  await page.screenshot({ path: 'test/e2e/shots/align-fail.png', fullPage: true })
  await browser.close()
  server.close()
  process.exit(1)
}

// ─── hover 一个 src token，检查 paired 高亮 ────────────────
console.log('[e2e] → 模拟 hover src 第一个 token')
const hoverInfo = await page.evaluate(() => {
  const srcSpan = document.querySelector('[data-xt-tok="src"]')
  if (!srcSpan) return { error: 'no src span' }
  // 触发 mouseover via event
  const ev = new MouseEvent('mouseover', { bubbles: true, cancelable: true })
  srcSpan.dispatchEvent(ev)
  // 读结果
  const segId = srcSpan.getAttribute('data-xt-seg')
  const activeCount = document.querySelectorAll(`[data-xt-seg="${segId}"].xt-hover-active`).length
  const pairCount = document.querySelectorAll(`[data-xt-seg="${segId}"].xt-hover-pair`).length
  return {
    segId,
    srcText: srcSpan.textContent,
    activeCount,
    pairCount,
  }
})
console.log('[e2e] hover 结果:', hoverInfo)

await page.screenshot({ path: 'test/e2e/shots/align-hover.png', fullPage: true })

// ─── 验收断言 ───────────────────────────────────────────────
const passed =
  aligned > 0 &&
  hoverInfo.activeCount === 1 &&
  hoverInfo.pairCount >= 1

console.log('\n═══════════════════════════════════════════')
console.log('  W1-5 E2E 结果:', passed ? '✓ PASS' : '✗ FAIL')
console.log('═══════════════════════════════════════════')
console.log(`  对齐 tokens 数: ${aligned}`)
console.log(`  hover active: ${hoverInfo.activeCount}`)
console.log(`  hover pair:   ${hoverInfo.pairCount}`)

// 也存一份 token DOM 快照便于排查
const domDump = await page.evaluate(() => {
  const seg = document.querySelector('[data-xt-tok]')?.getAttribute('data-xt-seg')
  if (!seg) return null
  return {
    segmentId: seg,
    srcTokens: [...document.querySelectorAll(`[data-xt-tok="src"][data-xt-seg="${seg}"]`)].map(e => e.textContent),
    tgtTokens: [...document.querySelectorAll(`[data-xt-tok="tgt"][data-xt-seg="${seg}"]`)].map(e => e.textContent),
  }
})
writeFileSync('test/e2e/shots/align-dom-dump.json', JSON.stringify(domDump, null, 2))
console.log('  DOM dump:', domDump)

await browser.close()
server.close()
process.exit(passed ? 0 : 1)
