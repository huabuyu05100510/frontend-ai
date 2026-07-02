import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:5175'

test('分片对比 — 渲染首屏对比：两侧均能正常渲染', async ({ page }) => {
  const consoleErrors: string[] = []
  const rangeRequests: number[] = []  // response sizes from range mode
  const fullRequests: number[] = []   // response sizes from full mode

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => consoleErrors.push(err.message))

  // 1. 打开页面
  await page.goto(BASE, { waitUntil: 'load' })

  // 2. 切换到「分片 vs 全量对比」tab
  await page.click('.tab:has-text("分片 vs 全量对比")')

  // 3. 切换到「渲染首屏对比」子 tab
  await page.click('button:has-text("渲染首屏对比")')

  // ═══════════════════════════════════════════════════════════════════
  // Phase 1: 左侧 — Range 分片加载
  // ═══════════════════════════════════════════════════════════════════

  // 开始监听网络请求
  page.on('response', async (response) => {
    if (response.url().includes('range.pdf')) {
      try {
        const body = await response.body()
        rangeRequests.push(body.length)
      } catch { /* body too large */ }
    }
  })

  await page.click('button:has-text("pdf.js 分片")')
  await page.waitForTimeout(15000)

  await page.screenshot({ path: 'e2e/screenshots/range-compare-range.png', fullPage: true })

  // 验证左侧渲染成功
  const leftCanvases = await page.locator('canvas').count()
  expect(leftCanvases).toBeGreaterThan(0)

  // 验证显示了「首帧可见」计时
  const leftText = await page.textContent('body')
  expect(leftText).toContain('首帧可见')
  expect(leftText).not.toContain('PDF.js 加载失败')

  // 验证 Range 请求：每次请求应该 < 1MB（分片请求），不应该有 164MB 的全量下载
  const totalRangeBytes = rangeRequests.reduce((s, r) => s + r, 0)
  const largeRequests = rangeRequests.filter(r => r > 100 * 1024 * 1024)
  console.log(`\n[Range mode] ${rangeRequests.length} requests, ${(totalRangeBytes / 1024).toFixed(0)}KB total`)
  expect(largeRequests.length).toBe(0)  // 没有 164MB 全量下载
  expect(rangeRequests.length).toBeGreaterThan(0)

  // ═══════════════════════════════════════════════════════════════════
  // Phase 2: 右侧 — 全量加载
  // ═══════════════════════════════════════════════════════════════════

  page.on('response', async (response) => {
    if (response.url().includes('range.pdf')) {
      try {
        const body = await response.body()
        fullRequests.push(body.length)
      } catch { /* body too large */ }
    }
  })

  await page.click('button:has-text("pdf.js 全量")')
  await page.waitForTimeout(25000)

  await page.screenshot({ path: 'e2e/screenshots/range-compare-both.png', fullPage: true })

  // 验证右侧也渲染成功
  const allCanvases = await page.locator('canvas').count()
  console.log(`[Full mode] ${fullRequests.length} requests, ${(fullRequests.reduce((s, r) => s + r, 0) / 1024 / 1024).toFixed(1)}MB total`)
  console.log(`Canvas count: before=${leftCanvases}, after=${allCanvases}`)
  expect(allCanvases).toBeGreaterThan(leftCanvases)

  // 验证无错误
  const realErrors = consoleErrors.filter(e =>
    !e.includes('echarts') &&
    !e.includes('ResizeObserver') &&
    !e.includes('Failed to load resource: the server responded with a status of 404')
  )
  console.log('Console errors:', realErrors)
  expect(realErrors.length).toBe(0)
})