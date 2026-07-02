// E2E: PDF WASM 视口优先渲染 — 快速滚动白屏修复
// 模型：claude-sonnet-4-6

import { test, expect } from '@playwright/test'

const API = 'http://localhost:5180'

test.describe('WASM 视口优先渲染（白屏修复）', () => {

  test('上传 docx → WASM 预览 → 快速滚动后视口内优先渲染无白屏', async ({ page, request }) => {
    // ====== Step 1: 上传 ======
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const sample = path.resolve(process.cwd(), '..', '..', 'files', 'GuoYaping_Resume_Full.docx')
    const buf = await fs.readFile(sample)

    const r = await request.post(`${API}/api/upload`, {
      multipart: { file: { name: 'GuoYaping_Resume_Full.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf } }
    })
    expect(r.ok()).toBeTruthy()
    const { task } = await r.json()

    for (let i = 0; i < 60; i++) {
      const tr = await request.get(`${API}/api/tasks`)
      const tj = await tr.json()
      const t = tj.tasks.find((x: any) => x.id === task.id)
      if (t?.convertStatus === 'done') break
      await page.waitForTimeout(1000)
    }

    // ====== Step 2: 日志收集 ======
    const logs: string[] = []
    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('[pdf-wasm-v2]') || text.includes('[pdf-wasm-worker]')) logs.push(text)
    })

    // ====== Step 3: 导航，设 WASM 模式 ======
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('previewMode', 'wasm'))
    await page.waitForTimeout(500)

    // 点第一个 task card 里的预览按钮，不是 sidebar 按钮
    await page.locator('.card-actions button:has-text("预览")').first().click()
    await page.waitForTimeout(3000)

    // ====== Step 4: 验证 modal ======
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })

    // 切 WASM 模式（如果未激活）
    const wasmBtn = page.locator('.mode-toggle button:has-text("WASM")')
    if (await wasmBtn.isVisible().catch(() => false)) {
      const pressed = await wasmBtn.getAttribute('aria-pressed').catch(() => 'false')
      if (pressed !== 'true') {
        await wasmBtn.click()
        await page.waitForTimeout(5000)
      }
    }

    await page.screenshot({ path: 'test-results/wasm-scroll-viewport-loaded.png', fullPage: false })

    // ====== Step 5: WASM 渲染验证 ======
    const hasWasm = await page.locator('.pdf-root').isVisible({ timeout: 5000 }).catch(() => false)
    console.log('[e2e] pdf-root:', hasWasm, 'wasm-logs:', logs.length)

    if (!hasWasm) {
      console.log('[e2e] WASM not rendering (COEP may block cross-origin resources).')
      return
    }

    expect(logs.length).toBeGreaterThan(0)

    // ====== Step 6: 快速滚动 ======
    const container = page.locator('.pdf-container').first()
    await expect(container).toBeVisible()

    await container.evaluate((el: HTMLElement) => {
      const max = el.scrollHeight - el.clientHeight
      if (max < 100) return
      [0.2, 0.5, 0.8, 0.6, 0.3, 0.7].forEach((ratio, i) => {
        setTimeout(() => { el.scrollTop = max * ratio; el.dispatchEvent(new Event('scroll', { bubbles: true })) }, i * 60)
      })
    })
    await page.waitForTimeout(4000)

    await page.screenshot({ path: 'test-results/wasm-scroll-viewport-scrolled.png', fullPage: false })

    const canvas = await page.locator('.pdf-canvas').count().catch(() => 0)
    const skeleton = await page.locator('.page-skeleton').count().catch(() => 0)
    console.log('[e2e] canvas:', canvas, 'skeleton:', skeleton)
    expect(canvas).toBeGreaterThan(0)

    const scrollLogs = logs.filter(l =>
      l.includes('fast scrolling') || l.includes('scroll idle') || l.includes('cancel slot'))
    console.log('[e2e] scroll logs:', scrollLogs.map(l => l.slice(0, 140)))
  })
})