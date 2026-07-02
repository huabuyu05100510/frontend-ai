// 模型：claude-sonnet-4-6
// translate-docx-tm — 文档翻译 + 翻译记忆 (TM)
//
// 验证点：
//   1. 服务端创建 TM 条目 → lookup → 触发 standalone 翻译（X-Translate-TM-Hits 头）
//   2. UI：TM 面板渲染 + 阈值滑块
//   3. 视觉回归：TM 面板快照

import { test, expect } from '@playwright/test'
import {
  gotoTranslateDocMode,
  createTmEntry,
} from './translate-helpers'

const API = 'http://localhost:5180'

test.describe('文档翻译 — 翻译记忆 (TM)', () => {
  test('1. 服务端：创建 TM → lookup → standalone 翻译观测', async ({ request }) => {
    // 1.1 创建 TM 条目（用简单字符串便于 lookup 命中）
    const tm1 = await createTmEntry(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: 'TM测试短语',
      target: 'TM test phrase',
    })
    expect(tm1.id).toBeTruthy()

    // 1.2 lookup（降低 threshold 提高命中率）
    const lookupResp = await request.get(
      `${API}/api/translate/memory?sourceLang=zh-CN&targetLang=en&q=${encodeURIComponent('TM测试短语')}&threshold=0.5`,
    )
    expect(lookupResp.status()).toBe(200)
    const lookupBody = await lookupResp.json()
    const items = lookupBody.items || []
    // 至少能查到自己刚创建的条目（完全匹配 score=1.0）
    expect(items.length).toBeGreaterThanOrEqual(1)
    // items[0] 可能是高分的；只要包含我们创建的就 ok
    const sources = items.map((i: { source: string }) => i.source)
    expect(sources.some((s: string) => s.includes('TM'))).toBeTruthy()

    // 1.3 standalone 翻译观测头
    const jobId = 'tj_tm_' + Date.now().toString(36)
    const r = await request.post(`${API}/api/inspect/translate`, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
      data: {
        taskId: 'standalone',
        text: 'TM测试短语',
        sourceLang: 'zh-CN',
        targetLang: 'en',
        jobId,
      },
    })
    expect(r.status()).toBe(200)
    const h = r.headers()
    // TM hits 是可选的（取决于相似度阈值），至少头存在
    expect(h['x-translate-tm-hits']).toBeTruthy()
    expect(h['x-translate-engine']).toBeTruthy()
    expect(h['x-job-id']).toBe(jobId)
  })

  test('2. TM 面板：threshold slider + 列表', async ({ page, request }) => {
    // 预创建 TM
    await createTmEntry(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '记忆1',
      target: 'Memory 1',
    }).catch(() => {})

    await gotoTranslateDocMode(page)

    // 等 TM 面板渲染
    const panel = page.locator('[data-testid="doc-translate-memory-panel"]')
    await panel.waitFor({ timeout: 15_000 }).catch(() => {})
    await expect(panel).toBeVisible()

    // threshold slider 存在
    const slider = page.locator('[data-testid="doc-translate-memory-threshold"]')
    expect(await slider.count()).toBeGreaterThan(0)

    // 列表或 empty 至少一个
    const rows = await page.locator('[data-testid^="doc-translate-memory-row-"]').count()
    const empty = await page.locator('[data-testid="doc-translate-memory-empty"]').count()
    expect(rows + empty).toBeGreaterThan(0)

    // 调整 slider 不报错
    if (await slider.count() > 0) {
      await slider.first().evaluate((el: HTMLInputElement) => {
        el.value = '0.5'
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
  })

  test('3. 视觉回归：TM 面板快照', async ({ page, request }) => {
    await createTmEntry(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '快照测试',
      target: 'Snapshot Test',
    }).catch(() => {})

    await gotoTranslateDocMode(page)
    const panel = page.locator('[data-testid="doc-translate-memory-panel"]')
    await panel.waitFor({ timeout: 15_000 }).catch(() => {})

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(800)

    await expect(panel).toHaveScreenshot('translate-docx-tm-panel.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    })
  })
})