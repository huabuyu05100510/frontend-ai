/**
 * 精准漏翻诊断：对指定 URL，列出所有「含拉丁字母的可翻译文字节点」
 * 与「extension 实际提取的段」对比，找出漏翻的具体文案。
 *
 * 用法：node test/ext-missed-probe.mjs <url>
 */
import { chromium } from 'playwright'

const url = process.argv[2] || 'https://www.alibaba.com/'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('nav:', e.message))
await page.waitForTimeout(4000)

// 1) 列出所有「含拉丁字母且未在 xt 系列属性里」的文字节点
const missed = await page.evaluate(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const n = walker.currentNode
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim()
    if (t.length < 4) continue
    // 必须含拉丁字母
    if (!/[A-Za-z]/.test(t)) continue
    // 跳过 code/pre 等
    const parent = n.parentElement
    if (!parent) continue
    if (SKIP.has(parent.tagName)) continue
    if (parent.closest('script,style,noscript,code,pre,textarea,input,select,svg,math')) continue
    // 排除已被扩展标记的（attribute on ancestor）
    if (parent.closest('[data-xt-id]')) continue
    // 排除译文元素自身
    if (parent.closest('[data-xt-tgt]')) continue
    out.push({ text: t.slice(0, 80), tag: parent.tagName, cls: (parent.className || '').toString().slice(0, 40) })
  }
  return out
})

console.log(`\n=== ${url} ===`)
console.log(`含拉丁字母但未被提取的文字节点: ${missed.length}`)
console.log(`\n前 40 条:`)
for (const m of missed.slice(0, 40)) {
  console.log(`  <${m.tag}${m.cls ? ' class="' + m.cls + '"' : ''}> ${m.text}`)
}

await page.screenshot({ path: 'test/shots/ext-missed-probe.png', fullPage: false })
await browser.close()
