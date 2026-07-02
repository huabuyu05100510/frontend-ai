// OCR 识别 + 对比 — Playwright 端到端测试
// 模型：claude-sonnet-4-6
import { test, expect } from '@playwright/test'

test.describe('OCR 识别 端到端', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[browser-console-error]', msg.text())
    })
  })

  test('API: POST /api/ocr/recognize — 图片 OCR 识别', async ({ request }) => {
    // 先获取任务列表，找一张图片
    const tasksResp = await request.get('/api/tasks')
    expect(tasksResp.ok()).toBeTruthy()
    const { tasks } = await tasksResp.json()
    const imageTask = tasks.find((t: any) => ['png', 'jpg', 'jpeg', 'bmp'].includes(t.ext))
    if (!imageTask) {
      test.skip(true, 'No image task available for OCR test')
      return
    }

    const resp = await request.post('/api/ocr/recognize', {
      data: { taskId: imageTask.id },
    })
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result).toHaveProperty('text')
    expect(result).toHaveProperty('regions')
    expect(result).toHaveProperty('engine')
    expect(result).toHaveProperty('ms')
    expect(Array.isArray(result.regions)).toBe(true)

    console.log(`[e2e-ocr] engine=${result.engine} text=${result.text?.length||0} regions=${result.regions.length} ms=${result.ms}`)
  })

  test('API: POST /api/ocr/compare — OCR 结果对比', async ({ request }) => {
    const ref = '这是一段标准测试文本用于OCR识别准确率计算'
    const ocr = '这是一段标准测试文木用于OCR识别准确率计算' // "本" → "木"

    const resp = await request.post('/api/ocr/compare', {
      data: { reference: ref, test: ocr },
    })
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.meta).toBeTruthy()

    console.log(`[e2e-ocr-compare] errors=${result.errors.length} ms=${result.ms}`)
  })

  test('API: GET /api/health/ocr — 健康检查', async ({ request }) => {
    const resp = await request.get('/api/health/ocr')
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result.ok).toBe(true)
    expect(result).toHaveProperty('providers')
    expect(result).toHaveProperty('modes')
  })
})

test.describe('质量检测 端到端', () => {
  test('API: POST /api/inspect/quality-check — AI 语义校对', async ({ request }) => {
    const text = '这是一段有错别字的文本，其中包含了一些常见的问题例如中英文标点混用,重复的标点。。'

    const resp = await request.post('/api/inspect/quality-check', {
      data: { text },
    })
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result).toHaveProperty('errors')
    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('engine')
    expect(result).toHaveProperty('ms')
    expect(typeof result.summary.total).toBe('number')

    console.log(`[e2e-qc] engine=${result.engine} errors=${result.errors.length} ms=${result.ms}`)
  })

  test('API: POST /api/inspect/phrase-errors — 短语级错误检测', async ({ request }) => {
    const resp = await request.post('/api/inspect/phrase-errors', {
      data: { left: '你好世界', right: '你好师姐' },
    })
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result).toHaveProperty('errors')
    expect(result).toHaveProperty('tokens_left')
    expect(result).toHaveProperty('tokens_right')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.tokens_left)).toBe(true)

    console.log(`[e2e-phrase] errors=${result.errors.length} tokens=${result.tokens_left.length}/${result.tokens_right.length} ms=${result.ms}`)
  })

  test('API: POST /api/inspect/diff — 字符级 diff + 段落级 diff', async ({ request }) => {
    const resp = await request.post('/api/inspect/diff', {
      data: { left: '原文和译文应该是相同的格式', right: '原文和译文格式应该是一样的', granularity: 'paragraph' },
    })
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result.ops.length).toBeGreaterThan(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result).toHaveProperty('paragraphBlocks')

    console.log(`[e2e-diff] ops=${result.ops.length} errors=${result.errors.length} paragraphs=${result.paragraphBlocks?.length}`)
  })

  test('API: GET /api/health/translate — 翻译 Provider 健康检查', async ({ request }) => {
    const resp = await request.get('/api/health/translate')
    expect(resp.ok()).toBeTruthy()
    const result = await resp.json()
    expect(result.ok).toBe(true)
    expect(result).toHaveProperty('providers')
    expect(result).toHaveProperty('active')
    expect(result.providers).toContain('mock')

    console.log(`[e2e-translate-health] providers=${result.providers.join(',')} active=${result.active}`)
  })
})