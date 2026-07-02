// E2E: v4 像素级对齐验证（真实浏览器）
// 验证：span 在浏览器中的实际渲染位置 = 服务端 text layer 坐标，且无 transform 残留
// 模型：claude-sonnet-4-6
import { test, expect } from '@playwright/test'

const SERVER = 'http://localhost:5180'

// 用已转换好的 resume 任务（t_mqnh8au9e9faebb5），避免依赖 OnlyOffice
const RESUME_TASK_ID = 't_mqnh8au9e9faebb5'

test.describe('v4 文字层对齐 — 真实浏览器验证', () => {

  test('span 渲染宽度 = 服务端 inkWidth（v4.4：scaleX 精确对齐，hit area = PNG 文字）', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.locator('button:has-text("预览")').first().click()
    await page.waitForSelector('.pdf-image-page', { timeout: 10_000 })
    await page.waitForSelector('.pdf-text-layer span', { timeout: 10_000 })
    await page.waitForTimeout(2500) // 等 fonts.ready + useLayoutEffect

    // 从浏览器获取当前预览 taskId
    const currentTaskId = await page.evaluate(() => {
      const img = document.querySelector('img.pdf-images-page') as HTMLImageElement
      if (!img?.src) return null
      const m = img.src.match(/\/api\/files\/(t_[^?]+)/)
      return m ? m[1] : null
    })
    expect(currentTaskId).toBeTruthy()

    // 服务端原始 inkWidth（从 text HTML 解析）
    const textRes = await request.get(`${SERVER}/api/files/${currentTaskId}?as=text&n=1`)
    expect(textRes.status()).toBe(200)
    const textHtml = await textRes.text()
    const serverW = new Map<string, number>()
    const re = /<span style="[^"]*width:([\d.]+)px[^"]*"[^>]*>([^<]*)<\/span>/g
    let mm
    while ((mm = re.exec(textHtml)) !== null) {
      const t = mm[2].trim()
      if (t.length >= 2) serverW.set(t, parseFloat(mm[1]))
    }

    // 浏览器渲染宽度（transform 后）
    const actual = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pdf-text-layer span')).map(s => ({
        text: (s.textContent || '').slice(0, 15),
        renderedW: s.getBoundingClientRect().width,
        transform: (s as HTMLElement).style.transform
      })).filter(x => x.text.trim().length >= 2)
    })

    let checked = 0, maxDiff = 0
    for (const a of actual) {
      const sw = serverW.get(a.text)
      if (sw === undefined) continue
      const diff = Math.abs(a.renderedW - sw)
      if (diff > maxDiff) maxDiff = diff
      // v4.4: 渲染宽度应 = inkWidth（偏差 < 1.5px），hit area 精确覆盖 PNG 文字
      expect(diff, `span "${a.text}" 渲染宽度 ${a.renderedW.toFixed(2)} ≠ inkWidth ${sw}`).toBeLessThan(1.5)
      checked++
    }
    expect(checked, '至少检查 3 个 span').toBeGreaterThanOrEqual(3)
    // 整体最大偏差应 < 1px（box × sx = inkWidth 数学精确）
    expect(maxDiff).toBeLessThan(1)
  })

  test('span 渲染位置 = 服务端坐标（偏差 < 2px）', async ({ page, request }) => {
    // 打开预览（使用列表中第一个可预览的任务）
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.locator('button:has-text("预览")').first().click()
    await page.waitForSelector('.pdf-image-page', { timeout: 10_000 })
    await page.waitForSelector('.pdf-text-layer span', { timeout: 10_000 })
    await page.waitForTimeout(1500)

    // 从浏览器中获取当前预览的任务 ID（从第一个 img src 解析）
    const currentTaskId = await page.evaluate(() => {
      const img = document.querySelector('img.pdf-images-page') as HTMLImageElement
      if (!img?.src) return null
      const m = img.src.match(/\/api\/files\/(t_[^?]+)/)
      return m ? m[1] : null
    })
    expect(currentTaskId, '应能从 img.src 解析出 taskId').toBeTruthy()

    // 用当前预览的 taskId 获取 text layer HTML
    const textRes = await request.get(`${SERVER}/api/files/${currentTaskId}?as=text&n=1`)
    expect(textRes.status()).toBe(200)
    const textHtml = await textRes.text()

    // 解析前 5 个非空 span 的期望坐标
    const spanRe = /<span style="position:absolute;left:([\d.]+)px;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)[^"]*"[^>]*>([^<]*)<\/span>/g
    const expected: Array<{text:string, left:number, top:number, width:number, height:number}> = []
    let m
    while ((m = spanRe.exec(textHtml)) !== null) {
      const text = m[5].trim()
      if (text && expected.length < 5) {
        expected.push({
          left: parseFloat(m[1]), top: parseFloat(m[2]),
          width: parseFloat(m[3]), height: parseFloat(m[4]),
          text
        })
      }
    }
    expect(expected.length).toBeGreaterThan(0)

    // 获取页面 wrapper 的位置（作为坐标原点参考）
    const wrapperBox = await page.locator('.pdf-image-page').first().boundingBox()
    expect(wrapperBox).toBeTruthy()

    // 获取每个 span 在浏览器中的实际位置
    const actual = await page.evaluate(() => {
      const spans = document.querySelectorAll('.pdf-image-page .pdf-text-layer span')
      return Array.from(spans).map(s => {
        const rect = s.getBoundingClientRect()
        return {
          text: (s as HTMLElement).textContent?.slice(0, 20)?.trim(),
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          inlineLeft: parseFloat((s as HTMLElement).style.left),
          inlineTop: parseFloat((s as HTMLElement).style.top),
        }
      }).filter(s => s.text && s.text.length > 0)
    })

    expect(actual.length).toBeGreaterThan(0)

    // 对比：span 内联 style 的 left/top 应该 = 服务端坐标
    // span 相对于 page wrapper 的实际位置 也应该 = 内联 style left/top
    let checked = 0
    for (const exp of expected) {
      const found = actual.find(a => a.text === exp.text.slice(0, 20))
      if (!found) continue
      // 1. 内联 style left 应该 = 服务端坐标
      expect(Math.abs(found.inlineLeft - exp.left),
        `span "${exp.text}" inline left: 期望 ${exp.left}, 实际 ${found.inlineLeft}`
      ).toBeLessThan(1)
      expect(Math.abs(found.inlineTop - exp.top),
        `span "${exp.text}" inline top: 期望 ${exp.top}, 实际 ${found.inlineTop}`
      ).toBeLessThan(1)
      // 2. 实际渲染位置（相对于 page wrapper）应该 = 内联 style 坐标（偏差 < 2px）
      const actualLeft = found.left - wrapperBox!.x
      const actualTop = found.top - wrapperBox!.y
      expect(Math.abs(actualLeft - exp.left),
        `span "${exp.text}" render left: 期望 ${exp.left}, 实际 ${actualLeft.toFixed(1)}`
      ).toBeLessThan(2)
      expect(Math.abs(actualTop - exp.top),
        `span "${exp.text}" render top: 期望 ${exp.top}, 实际 ${actualTop.toFixed(1)}`
      ).toBeLessThan(2)
      checked++
    }
    expect(checked, '至少检查 3 个 span').toBeGreaterThanOrEqual(3)
  })

  test('page wrapper 尺寸 = PNG 像素尺寸（无拉伸）', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.locator('button:has-text("预览")').first().click()
    await page.waitForSelector('.pdf-image-page', { timeout: 10_000 })
    await page.waitForTimeout(500)

    // wrapper 尺寸应与 PNG IHDR 一致（991×1401 for resume）
    const wrapperInfo = await page.evaluate(() => {
      const w = document.querySelector('.pdf-image-page') as HTMLElement
      const img = w?.querySelector('img') as HTMLImageElement
      return {
        wrapperW: parseFloat(w?.style.width || '0'),
        wrapperH: parseFloat(w?.style.height || '0'),
        imgNaturalW: img?.naturalWidth || 0,
        imgNaturalH: img?.naturalHeight || 0
      }
    })

    // wrapper 尺寸必须与 PNG 原始像素一致（v4 核心：坐标系匹配）
    expect(wrapperInfo.wrapperW).toBe(wrapperInfo.imgNaturalW)
    expect(wrapperInfo.wrapperH).toBe(wrapperInfo.imgNaturalH)
  })

  test('截图：选区高亮与文字视觉对齐', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.locator('button:has-text("预览")').first().click()
    await page.waitForSelector('.pdf-image-page', { timeout: 10_000 })
    await page.waitForSelector('.pdf-text-layer span', { timeout: 10_000 })
    await page.waitForTimeout(1500)

    // 模拟选中第一个 span 的文字
    const firstSpan = page.locator('.pdf-text-layer span').first()
    const box = await firstSpan.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 5, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(300)
    }

    await page.screenshot({
      path: 'test-results/v4-selection-alignment.png',
      fullPage: false
    })

    // 验证截图文件存在
    const fs = await import('node:fs/promises')
    const stat = await fs.stat('test-results/v4-selection-alignment.png')
    expect(stat.size).toBeGreaterThan(1000) // 非空截图
  })
})
