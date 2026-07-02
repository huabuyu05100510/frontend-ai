/**
 * 纯 CDP（不依赖 Playwright）：检查 content script 注入 + 触发翻译
 */
const CDP = 'http://localhost:9333'

// 获取 targets
const targets = await fetch(`${CDP}/json/list`).then(r => r.json())
const page = targets.find(t => t.type === 'page' && t.url.includes('sample.html'))
const sw = targets.find(t => t.type === 'service_worker' && t.url.includes('chrome-extension') && !t.url.includes('nkeim'))

if (!page) { console.log('❌ 找不到 sample.html page'); process.exit(1) }
if (!sw) { console.log('❌ 找不到扩展 SW'); process.exit(1) }

const extId = sw.url.match(/chrome-extension:\/\/([^/]+)/)?.[1]
console.log(`[cdp] page: ${page.url}`)
console.log(`[cdp] ext id: ${extId}`)

// ─── 简易 CDP 客户端 ──────────────────────────────
let msgId = 0
const pending = new Map()

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  return new Promise(resolve => {
    ws.onopen = () => resolve(ws)
  })
}

function send(ws, method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function setupHandlers(ws) {
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result || msg.error)
      pending.delete(msg.id)
    }
  }
}

// ─── 1. 检查 sample.html 页面里 content script 注入情况 ─
console.log('\n[1] 检查 content script 注入...')
const pageWs = await connect(page.webSocketDebuggerUrl)
setupHandlers(pageWs)

await send(pageWs, 'Runtime.enable')

const probe = await send(pageWs, 'Runtime.evaluate', {
  expression: `(() => {
    const host = document.getElementById('xt-status-host')
    const overlay = host?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\\s+/g, ' ').trim()
    return JSON.stringify({
      url: location.href,
      overlay,
      hasChrome: typeof chrome !== 'undefined',
      runtimeId: chrome?.runtime?.id,
    })
  })()`,
  returnByValue: true,
})
console.log('[1] 页面状态:', JSON.parse(probe.result.value))

// ─── 2. 通过 SW 触发翻译 ───────────────────────────
console.log('\n[2] 连接 SW，触发翻译...')
const swWs = await connect(sw.webSocketDebuggerUrl)
setupHandlers(swWs)

await send(swWs, 'Runtime.enable')

// 在 SW 里：找到 sample.html 的 tabId，发 TRANSLATE 消息
const triggerResult = await send(swWs, 'Runtime.evaluate', {
  expression: `(async () => {
    const tabs = await chrome.tabs.query({})
    const target = tabs.find(t => t.url && t.url.includes('sample.html'))
    if (!target) return JSON.stringify({ error: 'no tab' })
    await chrome.tabs.sendMessage(target.id, {
      type: 'TRANSLATE',
      srcLang: 'auto',
      tgtLang: 'zh',
      mode: 'bilingual',
    })
    return JSON.stringify({ ok: true, tabId: target.id })
  })()`,
  awaitPromise: true,
  returnByValue: true,
})
console.log('[2] 触发结果:', JSON.parse(triggerResult.result.value))

// ─── 3. 轮询页面，等翻译完成 ────────────────────────
console.log('\n[3] 轮询翻译结果（最多 40s）...')
let final = null
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const r = await send(pageWs, 'Runtime.evaluate', {
    expression: `(() => {
      const overlay = document.getElementById('xt-status-host')?.shadowRoot?.querySelector('.panel')?.textContent?.replace(/\\s+/g, ' ').trim()
      return JSON.stringify({
        overlay,
        segments: document.querySelectorAll('[data-xt-id]').length,
        translations: document.querySelectorAll('[data-xt-tgt]').length,
        firstTgt: document.querySelector('[data-xt-tgt]')?.textContent?.slice(0, 80),
        firstSrc: document.querySelector('[data-xt-id]')?.textContent?.slice(0, 80),
      })
    })()`,
    returnByValue: true,
  })
  final = JSON.parse(r.result.value)
  if (i % 3 === 0 || final.translations > 0 || final.overlay?.match(/完成|失败/)) {
    console.log(`  [${i + 1}s] ${final.overlay} | segs=${final.segments} tgts=${final.translations}`)
  }
  if (final.translations > 0 || final.overlay?.includes('失败')) break
}

console.log('\n[final]', JSON.stringify(final, null, 2))

// 截图（通过 Page.captureScreenshot）
await send(pageWs, 'Page.enable')
const shot = await send(pageWs, 'Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync('test/e2e/shots/cdp-result.png', Buffer.from(shot.data, 'base64'))
console.log('\n截图: test/e2e/shots/cdp-result.png')

pageWs.close()
swWs.close()

const ok = final.translations > 0
console.log(ok ? '\n🎉 端到端 OK！' : '\n💥 翻译未生效')
process.exit(ok ? 0 : 1)
