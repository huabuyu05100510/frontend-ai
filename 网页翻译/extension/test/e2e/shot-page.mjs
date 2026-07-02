/**
 * 真实打开 MiniMax console 页面，截图 + 提取段落
 */
import { chromium } from 'playwright'

const URL = 'https://platform.minimaxi.com/console/plan'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
})
const page = await ctx.newPage()

console.log('→ 访问:', URL)
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('  nav:', e.message))

// 等 SPA 渲染
console.log('等待 SPA 渲染...')
await page.waitForTimeout(5000)

const url = page.url()
const title = await page.title()
console.log('  最终 URL:', url)
console.log('  title:', title)

// 截图原始页面
await page.screenshot({ path: 'test/e2e/shots/minimax-raw.png', fullPage: true })
console.log('  原始截图: test/e2e/shots/minimax-raw.png')

// 提取段落（与扩展逻辑相同）
const segments = await page.evaluate(() => {
  const BLOCK = new Set(['P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION','DT','DD','SPAN','DIV','A','BUTTON','LABEL'])
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','VAR','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])
  const out = []
  const seen = new WeakSet()
  function walk(el) {
    if (seen.has(el)) return
    if (SKIP.has(el.tagName)) return
    const text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
      ? el.childNodes[0].textContent
      : el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length >= 2 && !/^[\d\s\W]+$/.test(text) && text.length < 500) {
      // 只取叶子级（子节点里没有再可翻译的）
      let hasChild = false
      for (const c of el.children) {
        if (!SKIP.has(c.tagName)) { hasChild = true; break }
      }
      if (!hasChild) {
        out.push({ html: el.innerHTML, text })
        seen.add(el)
        return
      }
    }
    for (const c of el.children) walk(c)
  }
  walk(document.body)
  return out
})

console.log(`\n✅ 提取 ${segments.length} 段`)
segments.slice(0, 5).forEach((s, i) => console.log(`  [${i}] "${s.text.slice(0, 60)}"`))

await browser.close()

// 写入 segments 供下一步用
import { writeFileSync } from 'node:fs'
writeFileSync('/tmp/xt-segments.json', JSON.stringify(segments, null, 2))
console.log('\n段落已存: /tmp/xt-segments.json')
