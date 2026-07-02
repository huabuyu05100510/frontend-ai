/**
 * W2 漏翻探测：火山引擎 IAM + 阿里巴巴首页
 *   1. 抓页面，模拟 dom-walker 旧 vs 新逻辑，看提取段数对比
 *   2. 真实加载扩展翻译，看进度
 */
import { chromium } from 'playwright'
import path from 'node:path'

const EXT = path.resolve('extension/dist')
const browser = await chromium.launchPersistentContext('/tmp/ext-pw-leak', {
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
console.log('✅ SW:', extId)

// 捕获 SW 控制台日志
const swLogs = []
const attachSwLogger = () => {
  for (const w of browser.serviceWorkers()) {
    w.on('consolemessage', (e) => {
      const txt = e.text?.() ?? String(e)
      if (/xt:|翻译|批次|DeepL|align/i.test(txt)) swLogs.push(txt)
    })
  }
}
attachSwLogger()
browser.on('serviceworkercreated', () => setTimeout(attachSwLogger, 200))

async function testPage(url, label) {
  console.log(`\n========= ${label} (${url}) =========`)
  const page = await browser.newPage()
  const pageLogs = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (/xt:|翻译|批次|flush|scheduler|markDone|rollback/i.test(t)) pageLogs.push(t)
  })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('nav:', e.message))
    await page.waitForTimeout(4000)

    // 用新 dom-walker 逻辑算提取段数（不能直接调扩展内部，模拟）
    const extractCount = await page.evaluate(() => {
      const LEAF = new Set(['P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION','DT','DD','A','SPAN','LABEL','EM','STRONG','B','I','SUB','SUP','Q','CITE','TIME'])
      const CONTAINER = new Set(['DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','NAV','MAIN','FIGURE','DETAILS','SUMMARY'])
      const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','VAR','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])
      const BLOCK_SEL = [...LEAF, ...CONTAINER].map(t => t.toLowerCase()).join(',')
      let count = 0
      const sample = []
      function walk(el) {
        if (SKIP.has(el.tagName)) return
        if (el.closest?.('script,style,noscript,code,pre,textarea,input,select,svg,math')) return
        const tag = el.tagName
        if (LEAF.has(tag)) {
          const t = clean(el)
          if (t.length >= 4 && sample.length < 5) sample.push(t.slice(0, 60))
          if (t.length >= 4) count++
          return
        }
        if (CONTAINER.has(tag)) {
          if (el.querySelector(BLOCK_SEL)) {
            for (const c of el.children) walk(c)
            return
          }
          const t = clean(el)
          if (t.length >= 4) count++
          if (t.length >= 4 && sample.length < 5) sample.push(t.slice(0, 60))
          return
        }
        for (const c of el.children) walk(c)
      }
      function clean(el) {
        let t = ''
        for (const n of el.childNodes) {
          if (n.nodeType === 3) t += n.textContent
          else if (n.nodeType === 1 && !SKIP.has(n.tagName)) t += clean(n)
        }
        return t.replace(/\s+/g, ' ').trim()
      }
      walk(document.body)
      return { count, sample, bodyLen: document.body.textContent.length }
    })
    console.log(`  提取段数: ${extractCount.count}（body 字符数: ${extractCount.bodyLen}）`)
    console.log(`  样例:`)
    for (const s of extractCount.sample) console.log(`    - ${s}`)

    // 打开 popup 翻译
    const popup = await browser.newPage()
    await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
    await popup.waitForTimeout(500)
    await popup.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /翻译此页面/.test(x.textContent || ''))
      b?.click()
    })

    let lastLine = ''
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000)
      const r = await page.evaluate(() => ({
        injected: document.querySelectorAll('[data-xt-tgt]').length,
      }))
      const line = `  [${i*2}s] injected=${r.injected}`
      if (line !== lastLine) { console.log(line); lastLine = line }
      if (r.injected >= extractCount.count * 0.9 && r.injected > 5) {
        console.log(`  ✅ 翻译完成 ≥ 90% (${r.injected}/${extractCount.count})`)
        break
      }
    }
    await page.screenshot({ path: `test/shots/ext-${label}.png`, fullPage: false })
    // dump SW logs for this page
    console.log(`  --- SW 日志（最后 25 条）---`)
    for (const l of swLogs.slice(-25)) console.log(`  [sw] ${l}`)
    console.log(`  --- Page 日志（最后 30 条）---`)
    for (const l of pageLogs.slice(-30)) console.log(`  [pg] ${l}`)
    await popup.close()
  } finally {
    await page.close()
  }
}

await testPage('https://www.alibaba.com/', 'alibaba')
// await testPage('https://console.volcengine.com/iam/identitymanage/settings', 'volcengine-iam')

await browser.close()
