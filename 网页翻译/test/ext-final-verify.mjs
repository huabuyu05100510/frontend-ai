import { chromium } from 'playwright'
import path from 'node:path'

const EXT = path.resolve('extension/dist')
const browser = await chromium.launchPersistentContext('/tmp/ext-pw-final', {
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
await page.goto('https://www.alibaba.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('nav:', e.message))
await page.waitForTimeout(4000)

const popup = await browser.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
await popup.waitForTimeout(500)
await popup.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => /翻译此页面/.test(x.textContent || ''))
  b?.click()
})
await popup.close()

// 等翻译跑完（最多 60s）
let done = false
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  const progress = await page.evaluate(() => {
    const t = document.querySelector('#xt-status-host')?.shadowRoot?.querySelector('.detail')?.textContent || ''
    return t
  })
  if (/完成|✅/.test(progress)) { done = true; console.log('done at', i, 's:', progress); break }
}
await page.waitForTimeout(2000)

// 统计译文元素
const stats = await page.evaluate(() => {
  const translations = document.querySelectorAll('[data-xt-tgt]').length
  const sources = document.querySelectorAll('[data-xt-id]').length
  // 收集前 10 个双语对照样例
  const samples = []
  document.querySelectorAll('[data-xt-id]').forEach(src => {
    if (samples.length >= 8) return
    const id = src.getAttribute('data-xt-id')
    const tgt = document.querySelector(`[data-xt-tgt="${id}"]`)
    if (tgt) {
      samples.push({
        src: (src.textContent || '').trim().slice(0, 60),
        tgt: (tgt.textContent || '').trim().slice(0, 60),
      })
    }
  })
  return { translations, sources, samples }
})
console.log('sources(data-xt-id):', stats.sources)
console.log('translations(data-xt-tgt):', stats.translations)
console.log('samples:')
for (const s of stats.samples) console.log(`  [${s.src}] → [${s.tgt}]`)

await page.screenshot({ path: 'test/shots/ext-alibaba-final.png', fullPage: false })
await browser.close()
console.log('done=', done)
