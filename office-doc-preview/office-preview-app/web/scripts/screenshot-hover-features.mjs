// 5 个 AI 能力页 hover 联动 + 可视化能力演示截图（通过侧栏菜单）
// 模型：claude-sonnet-4-6
import { chromium } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const SCREEN_DIR = '/Users/didi/Downloads/前端AI/office-doc-preview/changes/ai-result-hover-linkage/screenshots'
fs.mkdirSync(SCREEN_DIR, { recursive: true })

const BASE = 'http://localhost:5188'
const FILE_NINGBO = '/Users/didi/Downloads/前端AI/office-doc-preview/files/宁波市.png'
const FILE_AUDIO = '/Users/didi/Downloads/前端AI/office-doc-preview/files/微信视频2026-01-28_123245_232 - Output.mp3'

async function goto(page, label) {
  await page.locator('.oa-sidemenu-item', { hasText: new RegExp('^' + label) }).click()
  await page.waitForTimeout(800)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', err => console.error('[pageerror]', err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text())
  })

  await page.goto(BASE)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)

  // ============ 1) Translation ============
  await goto(page, '智能翻译')
  await page.getByText('文本翻译').first().click().catch(() => {})
  await page.waitForTimeout(400)
  const ta = page.getByPlaceholder(/输入要翻译的文本/).first()
  if (await ta.count() > 0) {
    await ta.fill('今天我们开会讨论项目进度。\n下一议题是预算分配。\n请大家积极发言。')
    // 等翻译按钮启用 + 点击 + 等结果（mock 250ms debounce + ~50ms 翻译）
    const translateBtn = page.getByRole('button', { name: /^翻译$/ }).first()
    await translateBtn.click().catch(() => {})
    // 等结果渲染
    try {
      await page.waitForSelector('[data-testid="text-compare-row-0"]', { timeout: 5000 })
    } catch (e) {
      console.warn('[translate] text-compare-row-0 not rendered within timeout')
    }
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(SCREEN_DIR, '01-translate-baseline.png') })

    // 等 hover 行渲染
    const row0 = page.locator('[data-testid="text-compare-row-0"]').first()
    if (await row0.count() > 0) {
      await row0.hover()
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(SCREEN_DIR, '02-translate-hover-row0.png') })
    } else {
      console.warn('[translate] text-compare-row-0 not found, skipping hover screenshot')
    }
  }

  // ============ 2) OCR ============
  await goto(page, 'OCR 识别')
  await page.getByText('图片识别').first().click().catch(() => {})
  await page.waitForTimeout(500)
  const fileInput = page.locator('input[type="file"]').first()
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(FILE_NINGBO)
    await page.waitForTimeout(3500)
  }
  // 点开始识别
  const ocrBtn = page.locator('button.xf-btn-solid').filter({ hasText: /开始识别|识别中/ }).first()
  await ocrBtn.click().catch(() => {})
  // 等识别完成（mock ~1.5s，真实 baidu API 可能 2-3s）
  await page.waitForTimeout(4000)
  await page.screenshot({ path: path.join(SCREEN_DIR, '03-ocr-baseline.png') })

  // hover 区域（rect 是 SVGElement）
  const rect = page.locator('[data-testid^="ocr-region-rect-"]').first()
  if (await rect.count() > 0) {
    await rect.hover({ force: true })
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(SCREEN_DIR, '04-ocr-hover-region.png') })
  } else {
    console.warn('[ocr] ocr-region-rect-* not found')
  }

  // hover 文字卡 → tooltip 消失，rect 加粗
  const card = page.locator('[data-testid^="ocr-region-card-"]').first()
  if (await card.count() > 0) {
    await card.hover()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SCREEN_DIR, '05-ocr-hover-card.png') })
  }

  // export pdf
  const expBtn = page.getByTestId('ocr-export-pdf')
  if (await expBtn.count() > 0) {
    await expBtn.click()
    await page.waitForTimeout(3000)
    await page.screenshot({ path: path.join(SCREEN_DIR, '06-ocr-export-pdf.png') })
  }

  // ============ 3) QualityCheck ============
  await goto(page, '智检校对')
  await page.getByText('文字校对').first().click().catch(() => {})
  await page.waitForTimeout(2000) // 等样例加载
  const qcBtn = page.locator('button.xf-btn-solid').filter({ hasText: /开始校对|校对中/ }).first()
  await qcBtn.click().catch(() => {})
  // 等校对完成（sample 文本 ~22s；带 selector 等待更稳）
  try {
    await page.waitForSelector('[data-err-id]', { timeout: 30000 })
  } catch (e) {
    console.warn('[qc] data-err-id not rendered within 30s timeout')
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(SCREEN_DIR, '07-qc-baseline.png') })

  // hover token
  const token = page.locator('[data-err-id]').first()
  if (await token.count() > 0) {
    await token.hover()
    await page.waitForTimeout(700)
    await page.screenshot({ path: path.join(SCREEN_DIR, '08-qc-hover-token.png') })
  } else {
    console.warn('[qc] data-err-id tokens not found')
  }

  // hover error card → 对应 token 高亮 + scrollIntoView
  const errCards = page.locator('[data-testid^="qc-error-card-"]')
  if (await errCards.count() > 1) {
    await errCards.nth(1).hover()
    await page.waitForTimeout(700)
    await page.screenshot({ path: path.join(SCREEN_DIR, '09-qc-hover-card.png') })
  }

  // 改正后双栏
  const correctedPane = page.getByTestId('qc-corrected-pane')
  if (await correctedPane.count() > 0) {
    await correctedPane.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SCREEN_DIR, '10-qc-corrected-pane.png') })
  }

  // ============ 4) Voice ============
  await goto(page, '语音中心')
  await page.getByText('音频翻译').first().click().catch(() => {})
  await page.waitForTimeout(800)
  const audioInput = page.locator('input[type="file"]').first()
  if (await audioInput.count() > 0) {
    await audioInput.setInputFiles(FILE_AUDIO)
    await page.waitForTimeout(3500)
  }
  const audioName = path.basename(FILE_AUDIO)
  const audioItem = page.getByText(audioName).first()
  if (await audioItem.count() === 0) {
    await page.getByText(/\.mp3$/).first().click().catch(() => {})
  } else {
    await audioItem.click()
  }
  await page.waitForTimeout(500)
  const asrBtn = page.getByRole('button').filter({ hasText: /ASR\s*\+\s*翻译/ }).first()
  await asrBtn.click().catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(SCREEN_DIR, '11-voice-baseline.png') })

  // hover segment 1 → 时间轴 marker 高亮 + 跳音频
  const seg1 = page.getByTestId('voice-segment-1')
  if (await seg1.count() > 0) {
    await seg1.hover()
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(SCREEN_DIR, '12-voice-hover-seg1.png') })
  }

  // 新增：hover 时间轴 marker → 双向联动
  const marker2 = page.getByTestId('voice-timeline-marker-2')
  if (await marker2.count() > 0) {
    await marker2.hover()
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(SCREEN_DIR, '13-voice-hover-timeline-marker.png') })
  }

  await browser.close()
  console.log('Screenshots saved to', SCREEN_DIR)
})()