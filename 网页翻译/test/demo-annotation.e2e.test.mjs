/**
 * demo 页标注面板 e2e
 *
 * 流程：
 *   1. 启动 server.mjs（已起在 8787）→ 打开 demo.html
 *   2. mock IDB：调 window.__seedDemoAnnotations() 预填 5 条（3 SEG_RATING + 2 ALIGN_FIX）
 *   3. 切到「📋 我的标注」tab → 验证显示
 *   4. 点「词级修正」过滤 → 验证只显示 2 条
 *   5. 点「📥 导出 JSONL」→ 验证下载文件是 valid JSONL
 *   6. 截图：test/shots/anno-03-demo-panel.png
 *
 * 至少 3 个 e2e cases。
 *
 * 前置：node server.mjs 跑在 8787
 * 启动：node --test test/demo-annotation.e2e.test.mjs
 *
 * 模型：Claude (Sonnet 4.6 / MiniMax-M3 路由)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '../extension/node_modules/playwright/index.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = path.resolve(__dirname, 'shots')
const BASE = 'http://localhost:8787'
const DOWNLOADS_DIR = path.resolve(__dirname, 'downloads')

test.before(async () => {
  await fs.mkdir(SHOTS_DIR, { recursive: true })
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true })
})

// ─── 共享工具 ───────────────────────────────────────────
async function openDemo(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  page.on('console', m => {
    const t = m.text()
    if (m.type() === 'error' || t.includes('[anno]')) console.log(`[browser:${m.type()}]`, t)
  })
  page.on('pageerror', e => console.log('[browser:err]', e.message))
  await page.goto(BASE)
  // 等 #annoList 在 DOM 中出现（不必可见，藏在 tab pane 里）
  await page.waitForSelector('#annoList', { state: 'attached' })
  return page
}

async function seedAnnotations(page, n = 5) {
  return await page.evaluate(async (count) => {
    return await window.__seedDemoAnnotations(count)
  }, n)
}

async function switchToAnnoTab(page) {
  await page.click('.tab[data-tab="annotations"]')
  // 等 tab pane 切换 + refresh 完成
  await page.waitForFunction(() => {
    const pane = document.querySelector('.tab-pane[data-pane="annotations"]')
    if (!pane || !pane.classList.contains('active')) return false
    // refresh 内部 await store.listByCreatedAt → set innerHTML
    // 等待 total 数字被更新（说明 stats 跑过）
    const total = document.getElementById('annoTotal')
    return total && total.textContent !== '0' || total.textContent === '0'
  })
  // 再等列表渲染
  await page.waitForFunction(() => {
    const list = document.getElementById('annoList')
    if (!list) return false
    return list.querySelector('.anno-card') || list.querySelector('.anno-empty')
  })
}

// ─── e2e case 1: 切到标注 tab 看到所有 5 条 + 统计正确 ───
test('demo-anno: 切到「我的标注」tab → 显示 5 条 + 统计正确', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await openDemo(browser)

  // 1) 预填
  const n = await seedAnnotations(page, 5)
  assert.equal(n, 5, 'seed 应返回 5')

  // 2) 切 tab
  await switchToAnnoTab(page)

  // 3) 统计
  const total = await page.textContent('#annoTotal')
  const last24h = await page.textContent('#annoLast24h')
  const cntAll = await page.textContent('#cntAll')
  const cntAlign = await page.textContent('#cntAlign')
  const cntRating = await page.textContent('#cntRating')
  console.log('[anno-1] 统计:', { total, last24h, cntAll, cntAlign, cntRating })
  assert.equal(total, '5', 'total 应为 5')
  assert.equal(cntAll, '5', 'cntAll 应为 5')
  assert.equal(cntAlign, '2', 'cntAlign 应为 2')
  assert.equal(cntRating, '3', 'cntRating 应为 3')
  assert.equal(last24h, '5', '5 条都应算在 24h 内')

  // 4) 卡片数
  const cardCount = await page.$$eval('.anno-card', els => els.length)
  assert.equal(cardCount, 5, `应有 5 张卡片，实际 ${cardCount}`)

  // 5) 卡片类型分布
  const kinds = await page.$$eval('.anno-card', els => els.map(e => Array.from(e.classList).find(c => c.startsWith('kind-'))))
  const alignCount = kinds.filter(k => k === 'kind-align_fix').length
  const ratingCount = kinds.filter(k => k === 'kind-seg_rating').length
  assert.equal(alignCount, 2, 'align_fix 卡片应 2 张')
  assert.equal(ratingCount, 3, 'seg_rating 卡片应 3 张')

  // 6) 截图（核心截图）
  await page.screenshot({ path: path.join(SHOTS_DIR, 'anno-03-demo-panel.png'), fullPage: true })
  console.log('[anno-1] 截图保存: anno-03-demo-panel.png')
})

// ─── e2e case 2: 点「词级修正」过滤 → 只显示 2 条 ───
test('demo-anno: 点「词级修正」过滤 → 只显示 2 条', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await openDemo(browser)
  await seedAnnotations(page, 5)
  await switchToAnnoTab(page)

  // 点过滤
  await page.click('#annoFilters button[data-kind="align_fix"]')
  await page.waitForFunction(() => {
    return document.querySelectorAll('.anno-card').length === 2
  }, { timeout: 5000 })

  const cardCount = await page.$$eval('.anno-card', els => els.length)
  assert.equal(cardCount, 2, `过滤后应剩 2 张，实际 ${cardCount}`)

  const allAlign = await page.$$eval('.anno-card', els =>
    els.every(e => e.classList.contains('kind-align_fix'))
  )
  assert.ok(allAlign, '所有卡片都应是 align_fix')

  // active 状态
  const activeBtn = await page.$('#annoFilters button.active')
  const activeKind = await activeBtn.getAttribute('data-kind')
  assert.equal(activeKind, 'align_fix', '过滤按钮 active 状态应切到 align_fix')

  // 切回「全部」
  await page.click('#annoFilters button[data-kind="all"]')
  await page.waitForFunction(() => document.querySelectorAll('.anno-card').length === 5)
  const restored = await page.$$eval('.anno-card', els => els.length)
  assert.equal(restored, 5, '切回全部应恢复 5 张')
})

// ─── e2e case 3: 点「📥 导出 JSONL」→ 下载文件是 valid JSONL ───
test('demo-anno: 点「📥 导出 JSONL」→ 下载 valid JSONL', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    acceptDownloads: true,
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('[browser:err]', e.message))
  await page.goto(BASE)
  await page.waitForSelector('#annoList', { state: 'attached' })
  await seedAnnotations(page, 5)
  await switchToAnnoTab(page)

  // 监听下载
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#exportJsonlBtn'),
  ])

  const suggested = download.suggestedFilename()
  console.log('[anno-3] 下载文件名:', suggested)
  assert.match(suggested, /^annotations-\d{8}\.jsonl$/, `文件名格式应为 annotations-YYYYMMDD.jsonl，实际 ${suggested}`)

  const savePath = path.join(DOWNLOADS_DIR, suggested)
  await download.saveAs(savePath)

  // 验证内容
  const content = await fs.readFile(savePath, 'utf8')
  const lines = content.trim().split('\n')
  console.log('[anno-3] JSONL 行数:', lines.length)
  assert.equal(lines.length, 5, `应有 5 行，实际 ${lines.length}`)

  for (let i = 0; i < lines.length; i++) {
    const obj = JSON.parse(lines[i])  // 必须 valid JSON
    assert.ok(obj.id, `第 ${i + 1} 行必须含 id`)
    assert.ok(obj.kind, `第 ${i + 1} 行必须含 kind`)
    assert.ok(['align_fix', 'seg_rating', 'alt_trans'].includes(obj.kind), `kind 合法`)
  }
  console.log('[anno-3] JSONL 内容样例:', lines[0].slice(0, 200))
})

// ─── e2e case 4: 「查看」按钮 → 展开 JSON 详情 ───
test('demo-anno: 「查看」按钮 → 展开 JSON 详情面板', async (t) => {
  const browser = await chromium.launch()
  t.after(async () => { await browser.close() })
  const page = await openDemo(browser)
  await seedAnnotations(page, 5)
  await switchToAnnoTab(page)

  // 初始：所有 detail 隐藏
  const initialShown = await page.$$eval('.anno-detail.show', els => els.length)
  assert.equal(initialShown, 0, '初始所有 detail 应隐藏')

  // 点第一张卡片的「查看」
  await page.click('.anno-card:nth-child(1) [data-act="view"]')
  await page.waitForFunction(() => document.querySelectorAll('.anno-detail.show').length === 1)
  const firstDetail = await page.textContent('.anno-card:nth-child(1) .anno-detail')
  assert.ok(firstDetail.length > 0, 'detail 应有内容')
  assert.match(firstDetail, /"id":/, 'detail 应含 JSON id 字段')
  assert.match(firstDetail, /"kind":/, 'detail 应含 JSON kind 字段')

  // 再点一次：折叠
  await page.click('.anno-card:nth-child(1) [data-act="view"]')
  await page.waitForFunction(() => document.querySelectorAll('.anno-detail.show').length === 0)
  const afterCollapse = await page.$$eval('.anno-detail.show', els => els.length)
  assert.equal(afterCollapse, 0, '再点应折叠')
})
