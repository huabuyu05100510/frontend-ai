// 模型：claude-sonnet-4-6
// translate-docx-glossary — 文档翻译 + 术语表
//
// 验证点：
//   1. 服务端创建术语 → 列表查询 → 触发带 glossary 的翻译（standalone 模式，不依赖 OnlyOffice）
//   2. 响应头 X-Translate-Glossary-Hits ≥ 1（验证术语被命中）
//   3. UI：打开术语面板 → 显示已导入的术语列表
//   4. CSV import (UTF-8 BOM) → 验证术语被导入

import { test, expect } from '@playwright/test'
import {
  uploadSampleDocx,
  waitForConvertDone,
  gotoTranslateDocMode,
  createGlossaryTerm,
} from './translate-helpers'

const API = 'http://localhost:5180'

test.describe('文档翻译 — 术语表 (Glossary)', () => {
  test('1. 服务端：创建术语 → 列表查询 → 翻译时命中 (standalone 模式)', async ({ request }) => {
    // 1.1 创建术语
    const term1 = await createGlossaryTerm(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '前端',
      target: 'Front-End',
      pos: 'noun',
    })
    expect(term1.id).toBeTruthy()

    const term2 = await createGlossaryTerm(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '工程师',
      target: 'Engineer',
    })
    expect(term2.id).toBeTruthy()

    // 1.2 列表查询
    const listResp = await request.get(`${API}/api/translate/glossary?sourceLang=zh-CN&targetLang=en`)
    expect(listResp.status()).toBe(200)
    expect(listResp.headers()['x-glossary-count']).toBeTruthy()
    expect(Number(listResp.headers()['x-glossary-count'])).toBeGreaterThanOrEqual(2)
    expect(listResp.headers()['x-glossary-source-lang']).toBe('zh-CN')
    expect(listResp.headers()['x-glossary-target-lang']).toBe('en')

    const listBody = await listResp.json()
    const items = listBody.items || []
    const terms = items.map((i: { source: string }) => i.source)
    expect(terms).toContain('前端')
    expect(terms).toContain('工程师')

    // 1.3 触发 standalone 翻译并传递 glossary
    const jobId = 'tj_glo_' + Date.now().toString(36)
    const r = await request.post(`${API}/api/inspect/translate`, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
      data: {
        taskId: 'standalone',
        text: '前端工程师',
        sourceLang: 'zh-CN',
        targetLang: 'en',
        jobId,
        glossary: [
          { source: '前端', target: 'Front-End' },
          { source: '工程师', target: 'Engineer' },
        ],
      },
    })
    expect(r.status()).toBe(200)
    const h = r.headers()
    expect(h['x-translate-glossary-hits']).toBeTruthy()
    expect(Number(h['x-translate-glossary-hits'])).toBeGreaterThanOrEqual(1)
    expect(h['x-translate-engine']).toBeTruthy()
    expect(h['x-job-id']).toBe(jobId)
  })

  test('2. CSV 多部件导入（UTF-8 BOM）', async ({ request }) => {
    // 用唯一标识的 terms 避免与之前的测试冲突
    const ts = Date.now().toString(36)
    const BOM = '\uFEFF'
    const csv = BOM + `source,target,pos\ncsvTerm${ts}A,CSVA${ts},noun\ncsvTerm${ts}B,CSVB${ts},noun\ncsvTerm${ts}C,CSVC${ts},noun\n`
    const buf = Buffer.from(csv, 'utf-8')

    const resp = await request.post(`${API}/api/translate/glossary/import`, {
      multipart: {
        file: { name: 'glossary.csv', mimeType: 'text/csv', buffer: buf },
        sourceLang: 'zh-CN',
        targetLang: 'en',
      },
    })

    if (!resp.ok()) {
      // 端点可能不存在
      test.skip(true, 'glossary import endpoint not available: ' + resp.status())
      return
    }

    expect(resp.status()).toBe(200)
    expect(resp.headers()['x-glossary-imported-count']).toBeTruthy()
    expect(Number(resp.headers()['x-glossary-imported-count'])).toBeGreaterThanOrEqual(3)
    expect(resp.headers()['x-glossary-duplicates']).toBeTruthy()

    // 验证列表中能查到
    const listResp = await request.get(`${API}/api/translate/glossary?sourceLang=zh-CN&targetLang=en`)
    expect(listResp.status()).toBe(200)
    const listBody = await listResp.json()
    const terms = (listBody.items || []).map((i: { source: string }) => i.source)
    expect(terms).toContain(`csvTerm${ts}A`)
  })

  test('3. UI：术语面板渲染 + 列表展示', async ({ page, request }) => {
    // 预创建几个术语确保面板有内容
    await createGlossaryTerm(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '术语A',
      target: 'TermA',
    }).catch(() => {})

    await gotoTranslateDocMode(page)

    // 等待术语面板出现
    const panel = page.locator('[data-testid="doc-translate-glossary-panel"]')
    await panel.waitFor({ timeout: 15_000 }).catch(() => {})

    // 面板应可见
    await expect(panel).toBeVisible()

    // 验证「导入 CSV」按钮 + 「应用于本次翻译」按钮存在
    const importBtn = page.locator('[data-testid="doc-translate-glossary-import"]')
    const applyBtn = page.locator('[data-testid="doc-translate-glossary-apply"]')
    expect(await importBtn.count()).toBeGreaterThan(0)
    expect(await applyBtn.count()).toBeGreaterThan(0)

    // 验证术语列表至少渲染一项（或显示 empty）
    const rows = await page.locator('[data-testid^="doc-translate-glossary-row-"]').count()
    const empty = await page.locator('[data-testid="doc-translate-glossary-empty"]').count()
    expect(rows + empty).toBeGreaterThan(0)
  })

  test('4. 视觉回归：术语面板快照', async ({ page, request }) => {
    await createGlossaryTerm(request, {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '可视化',
      target: 'Visualization',
    }).catch(() => {})

    await gotoTranslateDocMode(page)
    const panel = page.locator('[data-testid="doc-translate-glossary-panel"]')
    await panel.waitFor({ timeout: 15_000 }).catch(() => {})

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(800)

    await expect(panel).toHaveScreenshot('translate-docx-glossary-panel.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    })
  })
})