/**
 * 端到端验证：dom-walker 按目标语言过滤
 * - tgtLang=zh 时，纯中文段不应被提取（无 [data-xt-id]）
 * - 英文段应被提取（有 [data-xt-id]）
 * - 混合段（CJK+latin）应被提取（让 LLM 处理品牌术语）
 * - 修复前：纯中文也被提取，Key→密钥、整段中文被反向翻译成英文
 */
import { chromium } from 'playwright'
import http from 'node:http'

const extPath = '/Users/didi/Downloads/前端AI面试题/网页翻译/extension/dist'
const userDataDir = '/tmp/xt-langfilter-' + Date.now()

// 模拟用户截图中的双语混排页：纯中文段、英文段、CJK+latin 混合段
const HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>套餐详情</title></head>
<body>
  <h1>套餐详情</h1>                                            <!-- 纯 CJK → 跳过 -->
  <p>查看当前订阅状态、规格、订阅 Key 与续费管理</p>             <!-- 混合 → 提取 -->
  <p>用于 Token Plan / 积分调用，不可用于按量付费</p>             <!-- 混合 → 提取 -->

  <h2>订阅 Key (sk-cp)</h2>                                    <!-- 混合 → 提取 -->
  <p>View current subscription status and renewal management</p> <!-- 纯 EN → 提取 -->
  <p>View your current plan usage and remaining quota</p>        <!-- 纯 EN → 提取 -->

  <h2>套餐用量</h2>                                              <!-- 纯 CJK → 跳过 -->
  <p>当前周期：2026-06-01 至 2026-06-30</p>                       <!-- 纯 CJK+数字 → 跳过 -->
  <p>Subscribe to monthly membership with priority access</p>    <!-- 纯 EN → 提取 -->
  <p>到期日 2026-06-27</p>                                       <!-- 纯 CJK+数字 → 跳过 -->
</body>
</html>`

const srv = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(HTML)
})
await new Promise(r => srv.listen(8766, r))
console.log('[langfilter] HTTP up at http://localhost:8766')

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
console.log('[langfilter] extId:', extId)

const page = await browser.newPage()
page.on('console', m => console.log(`[page:${m.type()}]`, m.text().slice(0, 250)))
page.on('pageerror', e => console.log('[page:err]', e.message))

await page.goto('http://localhost:8766/', { waitUntil: 'load' })
await page.waitForTimeout(2000)

// 等扩展注入
await page.waitForFunction(() => !!document.getElementById('xt-status-host'), null, { timeout: 5000 })

// 打开 popup 点翻译
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(1500)
await popup.click('.primary-btn')
await popup.close()

// 等 extractSegments 跑完（[data-xt-id] 已被标记到 DOM）
await page.waitForFunction(
  () => document.querySelectorAll('[data-xt-id]').length > 0,
  null,
  { timeout: 8000 },
)
await page.waitForTimeout(300)

// 关键检查：每个 [data-xt-id] 元素的文本是什么？
const extracted = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-xt-id]')].map(el => ({
    text: el.textContent.trim().slice(0, 60),
    tag: el.tagName,
  }))
})
console.log('\n[langfilter] 提取出的段（应该只有混合+英文，不含纯中文）：')
extracted.forEach((e, i) => console.log(`  #${i + 1} <${e.tag}> "${e.text}"`))

// 纯中文段不应有 data-xt-id
const pureChineseNotExtracted = await page.evaluate(() => {
  const targets = [
    '套餐详情',
    '套餐用量',
    '当前周期：2026-06-01 至 2026-06-30',
    '到期日 2026-06-27',
  ]
  return targets.map(text => {
    const el = [...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6')].find(
      e => e.textContent.trim() === text,
    )
    return { text, hasId: el?.hasAttribute('data-xt-id') ?? false }
  })
})
console.log('\n[langfilter] 纯中文段过滤检查：')
pureChineseNotExtracted.forEach(c => console.log(`  ${c.hasId ? '❌' : '✅'} "${c.text}"`))

await page.screenshot({ path: '/tmp/xt-langfilter.png', fullPage: true })
console.log('\n[langfilter] 截图: /tmp/xt-langfilter.png')

await browser.close()
srv.close()

// 断言
const allPureChineseSkipped = pureChineseNotExtracted.every(c => !c.hasId)
// 期望提取 6 段：2 混合 p（"查看...Key 与续费管理" / "用于 Token Plan..."）+ 1 混合 h2（"订阅 Key (sk-cp)"）+ 3 纯 EN p
const expectedExtractCount = 6
const ok = allPureChineseSkipped && extracted.length === expectedExtractCount
console.log(`\n[langfilter] 结果：${ok ? '✅ 通过' : '❌ 失败'}（提取 ${extracted.length}/${expectedExtractCount} 段，纯中文过滤 ${allPureChineseSkipped ? 'OK' : '漏掉'}）`)
process.exit(ok ? 0 : 1)
