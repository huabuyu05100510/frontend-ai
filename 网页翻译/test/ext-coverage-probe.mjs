/**
 * 真实扩展提取覆盖率诊断：加载扩展 → 触发翻译 → 统计被 data-xt-id 覆盖的英文文字节点
 *
 * 用法：node test/ext-coverage-probe.mjs <url>
 */
import { chromium } from 'playwright'
import path from 'node:path'

const url = process.argv[2] || 'https://www.alibaba.com/'
const EXT = path.resolve('extension/dist')

const browser = await chromium.launchPersistentContext('/tmp/ext-pw-cov', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})

let sw
for (let i = 0; i < 30; i++) {
  sw = browser.serviceWorkers().find(w => w.url().includes('service-worker'))
  if (sw) break
  await new Promise(r => setTimeout(r, 500))
}
const extId = /chrome-extension:\/\/([^/]+)\//.exec(sw.url())?.[1]
console.log('SW:', extId)

const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('nav:', e.message))
await page.waitForTimeout(4000)

// 触发翻译
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(500)
await popup.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => /翻译此页面/.test(x.textContent || ''))
  b?.click()
})
await page.waitForTimeout(8000)
await popup.close()

// 统计英文文字节点被覆盖情况（W2-3: 递归 shadow root + 同域 iframe contentDocument）
const result = await page.evaluate(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])
  const stats = {
    total: 0, covered: 0, missed: [],
    byFrame: { top: { t: 0, c: 0 }, shadow: { t: 0, c: 0 }, iframe: { t: 0, c: 0 } },
  }

  function walkRoot(root, frame) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const n = walker.currentNode
      const t = (n.textContent || '').replace(/\s+/g, ' ').trim()
      if (t.length < 4) continue
      if (!/[A-Za-z]/.test(t)) continue
      const parent = n.parentElement
      if (!parent) continue
      if (SKIP.has(parent.tagName)) continue
      if (parent.closest('script,style,noscript,code,pre,textarea,input,select,svg,math')) continue
      if (parent.closest('[data-xt-tgt]')) continue
      stats.total++
      stats.byFrame[frame].t++
      if (parent.closest('[data-xt-id]')) {
        stats.covered++
        stats.byFrame[frame].c++
      } else {
        if (stats.missed.length < 30) {
          stats.missed.push({
            text: t.slice(0, 80), tag: parent.tagName, frame,
            ancestor: parent.parentElement?.tagName + '.' + (parent.parentElement?.className || '').toString().slice(0, 40),
          })
        }
      }
    }
    // W2-3: 递归 shadow root
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) walkRoot(el.shadowRoot, 'shadow')
    })
    // W2-3: 递归同域 iframe（跨域访问抛错被吞）
    root.querySelectorAll('iframe').forEach(f => {
      try {
        if (f.contentDocument?.body) walkRoot(f.contentDocument.body, 'iframe')
      } catch { /* cross-origin */ }
    })
  }
  walkRoot(document.body, 'top')
  return stats
})

console.log(`\n=== ${url} ===`)
console.log(`英文文字节点: ${result.total}`)
console.log(`被 data-xt-id 覆盖: ${result.covered} (${(result.covered / result.total * 100).toFixed(1)}%)`)
console.log(`漏掉的: ${result.total - result.covered}`)
console.log(`覆盖率 by frame:`)
for (const [f, s] of Object.entries(result.byFrame)) {
  const pct = s.t ? (s.c / s.t * 100).toFixed(1) : 'n/a'
  console.log(`  ${f}: ${s.c}/${s.t} (${pct}%)`)
}
console.log(`\n漏翻样例 (前 30):`)
for (const m of result.missed) {
  console.log(`  <${m.tag}> [${m.frame}] "${m.text}"  ← 父: ${m.ancestor}`)
}

await page.screenshot({ path: 'test/shots/ext-coverage-probe.png', fullPage: false })
await browser.close()
