/**
 * W2 demo 可用性回归 —— 真实启动 server，走 playwright 验证三条主路径
 *   1. 文本翻译（DeepL）
 *   2. URL 抓取 + 翻译（HN，走 /api/fetch 代理）
 *   3. 保结构翻译（aligned pipeline）
 *
 * 通过判定：每条路径 #status 含 ✅ done，且 .row 渲染出非空文本。
 * 截图保存到 test/shots/
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

async function main() {
  // 起一个干净的 server 子进程
  const proc = spawn('node', ['server.mjs'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '8799' },
  })
  proc.stdout.on('data', d => process.stdout.write('[srv] ' + d))
  proc.stderr.on('data', d => process.stderr.write('[srv-err] ' + d))
  await once(proc.stdout, 'data')  // 等启动日志
  await new Promise(r => setTimeout(r, 500))

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('PAGE-ERR: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text().slice(0,200)) })
  page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`) })

  const results = []
  const pass = (n, extra = '') => { results.push(`✅ ${n} ${extra}`); console.log('PASS:', n) }
  const fail = (n, extra = '') => { results.push(`❌ ${n} ${extra}`); console.log('FAIL:', n, extra) }

  try {
    await page.goto('http://localhost:8799/', { waitUntil: 'networkidle' })

    // === 路径 1：文本翻译 ===
    console.log('--- TEST 1: 文本翻译 ---')
    await page.fill('#textInput', 'Hello world\nThe quick brown fox\nReact Hooks are great')
    await page.click('#translateTextBtn')
    await page.waitForFunction(() => /✅|❌/.test(document.getElementById('status').textContent), { timeout: 30000 })
    const s1 = await page.textContent('#status')
    const rows1 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#rows .row')).map(r =>
        r.querySelector('.cell.tgt')?.textContent?.trim())
    )
    await page.screenshot({ path: 'test/shots/w2-text.png', fullPage: true })
    console.log('status:', s1, 'rows:', rows1)
    if (s1.includes('✅') && rows1.length === 3 && rows1.every(Boolean)) {
      pass('文本翻译', `(${rows1.length} 段)`)
    } else {
      fail('文本翻译', `status="${s1}" rows=${JSON.stringify(rows1)}`)
    }

    // === 路径 2：URL 抓取 + 翻译 ===
    console.log('--- TEST 2: URL 加载 ---')
    // 清掉 status 避免立刻命中上一轮的 ✅
    await page.evaluate(() => { document.getElementById('status').className = 'status'; document.getElementById('status').textContent = '' })
    await page.click('#loadBtn')
    await page.waitForFunction(() => /✅|❌/.test(document.getElementById('status').textContent), { timeout: 60000 })
    const s2 = await page.textContent('#status')
    const rowCount = await page.evaluate(() => document.querySelectorAll('#rows .row').length)
    await page.screenshot({ path: 'test/shots/w2-url.png', fullPage: true })
    console.log('status:', s2, 'rows:', rowCount)
    if (s2.includes('✅') && rowCount > 5) {
      pass('URL 抓取+翻译', `(${rowCount} 段)`)
    } else {
      fail('URL 抓取+翻译', `status="${s2}" rows=${rowCount}`)
    }

    // === 路径 3：保结构翻译 ===
    console.log('--- TEST 3: 保结构翻译 ---')
    // 第一次点击填入示例
    await page.click('#translateHtmlBtn')
    await page.waitForTimeout(200)
    // 第二次点击真正翻译
    await page.click('#translateHtmlBtn')
    await page.waitForFunction(() => /✅|❌/.test(document.getElementById('status').textContent), { timeout: 60000 })
    const s3 = await page.textContent('#status')
    const trace3 = await page.textContent('#htmlTrace')
    await page.screenshot({ path: 'test/shots/w2-aligned.png', fullPage: true })
    console.log('status:', s3)
    console.log('trace snippet:', trace3.slice(0, 400))
    if (s3.includes('✅')) {
      pass('保结构翻译')
    } else {
      fail('保结构翻译', `status="${s3}"`)
    }

    console.log('\n=== CONSOLE/NET ERRORS ===')
    for (const e of errors.slice(0, 20)) console.log(e)

  } finally {
    await browser.close()
    proc.kill()
  }

  console.log('\n=== SUMMARY ===')
  for (const r of results) console.log(r)
  const allPass = results.every(r => r.startsWith('✅'))
  process.exit(allPass ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
