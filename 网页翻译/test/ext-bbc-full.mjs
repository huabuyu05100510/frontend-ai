import { chromium } from 'playwright'
import path from 'node:path'
const EXT = path.resolve('extension/dist')
const browser = await chromium.launchPersistentContext('/tmp/ext-pw-bbc2', {
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

const page = await browser.newPage()
await page.goto('https://www.bbc.com/news', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

// 模拟旧 dom-walker（仅标准 BLOCK_TAGS）vs 新版
const cmp = await page.evaluate(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','VAR','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])
  function clean(el) {
    let t = ''
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent
      else if (n.nodeType === 1 && !SKIP.has(n.tagName)) t += clean(n)
    }
    return t.replace(/\s+/g, ' ').trim()
  }
  // 旧版
  const OLD_BLOCK = new Set(['P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION','DT','DD'])
  let oldCount = 0
  function walkOld(el) {
    if (SKIP.has(el.tagName)) return
    if (el.closest?.('script,style,noscript,code,pre,textarea,input,select,svg,math')) return
    if (OLD_BLOCK.has(el.tagName)) { const t = clean(el); if (t.length >= 4) oldCount++; return }
    for (const c of el.children) walkOld(c)
  }
  walkOld(document.body)

  // 新版
  const LEAF = new Set(['P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION','DT','DD','A','SPAN','LABEL','EM','STRONG','B','I','SUB','SUP','Q','CITE','TIME'])
  const CONTAINER = new Set(['DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','NAV','MAIN','FIGURE','DETAILS','SUMMARY'])
  const BLOCK_SEL = [...LEAF, ...CONTAINER].map(t => t.toLowerCase()).join(',')
  let newCount = 0
  function walkNew(el) {
    if (SKIP.has(el.tagName)) return
    if (el.closest?.('script,style,noscript,code,pre,textarea,input,select,svg,math')) return
    const tag = el.tagName
    if (LEAF.has(tag)) { const t = clean(el); if (t.length >= 4) newCount++; return }
    if (CONTAINER.has(tag)) {
      if (el.querySelector(BLOCK_SEL)) { for (const c of el.children) walkNew(c); return }
      const t = clean(el); if (t.length >= 4) newCount++; return
    }
    for (const c of el.children) walkNew(c)
  }
  walkNew(document.body)
  return { oldCount, newCount }
})
console.log(`BBC 旧提取: ${cmp.oldCount} 段, 新提取: ${cmp.newCount} 段, 提升: +${cmp.newCount - cmp.oldCount} (${((cmp.newCount/cmp.oldCount-1)*100).toFixed(0)}%)`)

// 触发翻译
const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(300)
await popup.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => /翻译此页面/.test(x.textContent || ''))
  b?.click()
})

let lastLine = ''
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  const r = await page.evaluate(() => ({
    injected: document.querySelectorAll('[data-xt-tgt]').length,
  }))
  const line = `[${i}s] injected=${r.injected}`
  if (line !== lastLine) { console.log(line); lastLine = line }
}
await page.screenshot({ path: 'test/shots/ext-bbc-new.png', fullPage: false })
await browser.close()
