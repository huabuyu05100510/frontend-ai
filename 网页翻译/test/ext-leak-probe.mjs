/**
 * 找漏翻：对比 BBC 全页可见文字节点 vs extractSegments 提取的段
 */
import { chromium } from 'playwright'
import path from 'node:path'

const EXT = path.resolve('extension/dist')
const browser = await chromium.launchPersistentContext('/tmp/ext-pw-profile3', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})

const page = await browser.newPage()
await page.goto('https://www.bbc.com/news', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)

// 模拟 dom-walker 提取逻辑
const analysis = await page.evaluate(() => {
  const BLOCK_TAGS = new Set(['P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION','DT','DD'])
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','VAR','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])

  // 1. 模拟 extractSegments
  const extracted = new Set()
  function walk(el) {
    if (SKIP_TAGS.has(el.tagName)) return
    if (el.closest?.('script,style,noscript,code,pre,textarea,input,select,svg,math')) return
    if (BLOCK_TAGS.has(el.tagName)) {
      const t = cleanText(el)
      if (t.length >= 4) extracted.add(t.slice(0, 60))
      return
    }
    for (const c of el.children) walk(c)
  }
  function cleanText(el) {
    let t = ''
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent
      else if (n.nodeType === 1 && !SKIP_TAGS.has(n.tagName)) t += cleanText(n)
    }
    return t.replace(/\s+/g, ' ').trim()
  }
  walk(document.body)

  // 2. 找所有"看起来是文字段"但没被提取的元素
  const missed = []
  const all = document.querySelectorAll('div, span, section, article, a, header, footer, nav, main, aside, figure, label, em, strong, b, i')
  all.forEach(el => {
    if (SKIP_TAGS.has(el.tagName)) return
    if (el.closest?.('script,style,noscript,code,pre,textarea,input,select,svg,math')) return
    // 直接 text node（不是嵌套在子元素里）
    let directText = ''
    for (const n of el.childNodes) {
      if (n.nodeType === 3) directText += n.textContent
    }
    directText = directText.replace(/\s+/g, ' ').trim()
    if (directText.length < 6) return  // 太短
    if (!/[\p{L}]/u.test(directText)) return
    // 检查这段是否已被 extractSegments 覆盖（任意祖先在 extracted 里）
    let covered = false
    for (const e of extracted) {
      if (directText.startsWith(e.slice(0, 30))) { covered = true; break }
    }
    if (!covered) {
      missed.push({
        tag: el.tagName,
        cls: el.className?.toString().slice(0, 60),
        text: directText.slice(0, 100),
      })
    }
  })

  return {
    extractedCount: extracted.size,
    missedSample: missed.slice(0, 30),
    missedTotal: missed.length,
  }
})

console.log('extracted segments:', analysis.extractedCount)
console.log('missed total:', analysis.missedTotal)
console.log('\n=== missed sample (前 30) ===')
for (const m of analysis.missedSample) {
  console.log(`  <${m.tag}.${m.cls}> ${m.text}`)
}

await browser.close()
