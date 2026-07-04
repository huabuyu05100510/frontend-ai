/**
 * ScrollBridge 验证：纯 iframe 场景下（不用 wujie DOM 投影）让虚拟列表工作
 *
 * 验证流程：
 *   1. 切到 waterfall，等 5s 让 activate + 首批 20 cards
 *   2. 断言 SDK 注入成功 (__SANDBOX_SCROLL_BRIDGE__ === 1)
 *   3. 断言 20 cards 渲染
 *   4. scroll shell 到 1500 → 等 1s → iframe scrollY=1500 (patched)
 *   5. scroll 到 3500 → 等 2s → loadMore 触发，cards > 20
 *   6. scroll 到 body 末尾 → 等 1s → footer 进入视口（content-driven 撑高 + footer 跟随）
 *   7. 切换到 vue2 → 等 3s → 正常加载
 *   8. 切回 waterfall → 等 1s → keep-alive 命中
 */
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 400)))

let pass = 0, fail = 0
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  console.log(`${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(actual)}`)
  ok ? pass++ : fail++
}

await page.goto('http://localhost:7180/', { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 1500))

// 切到 waterfall
await page.evaluate(() => {
  ;[...document.querySelectorAll('#side a')].find((x) => x.dataset.app === 'waterfall')?.click()
})
await new Promise((r) => setTimeout(r, 5000))

// 1+2+3: SDK 注入 + 首批 cards
const initial = await page.evaluate(() => {
  const ifs = [...document.querySelectorAll('#sandbox iframe')]
  const visible = ifs.find((f) => {
    const cs = getComputedStyle(f)
    return cs.visibility === 'visible' && f.getBoundingClientRect().height > 0
  })
  if (!visible?.contentWindow) return { err: 'no visible iframe' }
  const w = visible.contentWindow
  try {
    return {
      sdkInjected: w.__SANDBOX_SCROLL_BRIDGE__ === 1,
      scrollY: w.scrollY,
      innerHeight: w.innerHeight,
      cardCount: w.document.querySelectorAll('.card').length,
      mode: visible.dataset.mode || 'unknown',
    }
  } catch (e) { return { err: e.message } }
})
console.log('\n=== 初始（等 5s） ===')
console.log(JSON.stringify(initial, null, 2))
check('SDK 注入成功', initial.sdkInjected, true)
check('首批 20 cards', initial.cardCount, 20)

// 4. scroll 1500
await page.evaluate(() => window.scrollTo(0, 1500))
await new Promise((r) => setTimeout(r, 1000))
const r1 = await page.evaluate(() => {
  const ifs = [...document.querySelectorAll('#sandbox iframe')]
  const visible = ifs.find((f) => getComputedStyle(f).visibility === 'visible' && f.getBoundingClientRect().height > 0)
  return {
    scrollY: visible?.contentWindow?.scrollY,
    innerHeight: visible?.contentWindow?.innerHeight,
  }
})
console.log('\n=== scroll 1500 ===')
console.log(JSON.stringify(r1))
check('iframe scrollY=1500 (patched)', r1.scrollY, 1500)
check('iframe innerHeight=900 (patched)', r1.innerHeight, 900)

// 5. scroll 3500 → 等 loadMore
await page.evaluate(() => window.scrollTo(0, 3500))
await new Promise((r) => setTimeout(r, 2000))
const r2 = await page.evaluate(() => {
  const ifs = [...document.querySelectorAll('#sandbox iframe')]
  const visible = ifs.find((f) => getComputedStyle(f).visibility === 'visible' && f.getBoundingClientRect().height > 0)
  return {
    cardCount: visible?.contentDocument?.querySelectorAll('.card').length,
    bodyScrollH: visible?.contentDocument?.documentElement.scrollHeight,
  }
})
console.log('\n=== scroll 3500 ===')
console.log(JSON.stringify(r2))
check('loadMore 触发 (cards > 20)', r2.cardCount, (n) => n > 20)

// 6. 持续滚到 body 末尾（loadMore 会持续触发让 body 长高，必须边滚边加载）→ footer 进视口
for (let i = 0; i < 25; i++) {
  await page.mouse.wheel(0, 5000)
  await new Promise((r) => setTimeout(r, 300))
  const inView = await page.evaluate(() => {
    const f = document.getElementById('stream-footer')
    if (!f) return false
    const r = f.getBoundingClientRect()
    return r.top < window.innerHeight && r.bottom > 0
  })
  if (inView) break
}
const r3 = await page.evaluate(() => {
  const footer = document.getElementById('stream-footer')
  if (!footer) return { err: 'no footer' }
  const r = footer.getBoundingClientRect()
  return {
    footerTop: r.top,
    footerBottom: r.bottom,
    inViewport: r.top < 900 && r.bottom > 0,
  }
})
console.log('\n=== footer 跟随（持续滚到 loadMore 完成） ===')
console.log(JSON.stringify(r3))
check('footer 进入视口', r3.inViewport, true)

// 7. 切到 vue2-list（等 8s 让 CDN 慢加载兜底）
await page.evaluate(() => {
  ;[...document.querySelectorAll('#side a')].find((x) => x.dataset.app === 'vue2-list')?.click()
})
await new Promise((r) => setTimeout(r, 8000))
const r4 = await page.evaluate(() => {
  const ifs = [...document.querySelectorAll('#sandbox iframe')]
  const visible = ifs.find((f) => getComputedStyle(f).visibility === 'visible' && f.getBoundingClientRect().height > 0)
  try {
    return {
      readyState: visible?.contentDocument?.readyState,
      hasVue: typeof visible?.contentWindow?.Vue !== 'undefined',
    }
  } catch (e) { return { err: e.message } }
})
console.log('\n=== 切换到 vue2-list ===')
console.log(JSON.stringify(r4))
check('vue2 readyState=complete', r4.readyState, 'complete')
check('Vue defined', r4.hasVue, true)

// 8. 切回 waterfall → keep-alive
await page.evaluate(() => {
  ;[...document.querySelectorAll('#side a')].find((x) => x.dataset.app === 'waterfall')?.click()
})
await new Promise((r) => setTimeout(r, 1500))
const r5 = await page.evaluate(() => {
  const ifs = [...document.querySelectorAll('#sandbox iframe')]
  const visible = ifs.find((f) => getComputedStyle(f).visibility === 'visible' && f.getBoundingClientRect().height > 0)
  return {
    cardCount: visible?.contentDocument?.querySelectorAll('.card').length,
  }
})
console.log('\n=== 切回 waterfall（keep-alive） ===')
console.log(JSON.stringify(r5))
check('keep-alive 保留 cards', r5.cardCount, (n) => n >= 20)

console.log(`\n========================================
ScrollBridge E2E: ${pass} pass / ${fail} fail
========================================`)
await browser.close()
process.exit(fail > 0 ? 1 : 0)
