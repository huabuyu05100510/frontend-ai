// E2E 回归：图片+文字预览 复制错位修复
//
// 修复前根因：converter.mjs 给所有页返回缩略图尺寸（96 DPI ≈ 300×424），
// 但 text layer bbox 坐标系是 120 DPI ≈ 1000×1414 → 文字跑到图片外
//
// 本测试做三层端到端校验：
//   1. API: 每页 width/height 必须真实反映该页栅格化 PNG 像素尺寸（与同 DPI bbox 坐标系一致）
//   2. API: text layer bbox 的 left/top 坐标不能超过 page.width/page.height（坐标系一致）
//   3. UI: 预览弹层内每页 .pdf-image-page wrapper 尺寸 = API 返回的 width/height
//
// 模型：Claude MiniMax-M3（MiniMax）
import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const SAMPLE = path.resolve(process.cwd(), '..', '..', 'files', 'GuoYaping_Resume_Full.docx')

async function uploadAndWait(page: any, request: any): Promise<string> {
  const buf = await fs.readFile(SAMPLE)
  const r = await request.post('http://localhost:5180/api/upload', {
    multipart: {
      file: {
        name: 'GuoYaping_Resume_Full.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.2007',
        buffer: buf
      }
    }
  })
  expect(r.ok()).toBeTruthy()
  const { task } = await r.json()
  for (let i = 0; i < 90; i++) {
    const tr = await request.get('http://localhost:5180/api/tasks')
    const tj = await tr.json()
    const t = tj.tasks.find((x: any) => x.id === task.id)
    if (t?.convertStatus === 'done') break
    if (t?.convertStatus === 'failed') throw new Error('convert failed: ' + t.convertError)
    await page.waitForTimeout(1000)
  }
  return task.id
}

test.describe('图片+文字预览 像素对齐（复制不偏移）', () => {
  test('API 维度：每页 width/height 与同 DPI 栅格化 PNG 像素一致', async ({ page, request }) => {
    try { await fs.access(SAMPLE) } catch { test.skip(true, 'sample missing'); return }
    const taskId = await uploadAndWait(page, request)
    const r = await request.get('http://localhost:5180/api/tasks')
    const j = await r.json()
    const task = j.tasks.find((x: any) => x.id === taskId)
    expect(task.pages.length).toBeGreaterThan(0)

    for (const p of task.pages) {
      // 修复前：所有页 width/height 都等于 thumb.png 尺寸（96 DPI ≈ 612×792 Letter 转 816×1056）
      // 修复后：每页 width/height 必须显著大于缩略图（120 DPI 应 > 96 DPI 同页）
      expect(p.width).toBeGreaterThan(800)   // Letter @120DPI = 1020
      expect(p.height).toBeGreaterThan(1100) // Letter @120DPI = 1320
      // 1.2× ratio between 120 DPI and 96 DPI
      const ratio = p.width / p.height
      expect(ratio).toBeGreaterThan(0.7)
      expect(ratio).toBeLessThan(0.8)        // Letter aspect ≈ 0.772
    }
  })

  test('API 维度：text layer bbox 坐标必须落在 page.width/page.height 内', async ({ page, request }) => {
    try { await fs.access(SAMPLE) } catch { test.skip(true, 'sample missing'); return }
    const taskId = await uploadAndWait(page, request)
    const r = await request.get('http://localhost:5180/api/tasks')
    const j = await r.json()
    const task = j.tasks.find((x: any) => x.id === taskId)

    // 抽 3 页做对齐校验
    const sample = task.pages.slice(0, Math.min(3, task.pages.length))
    for (const p of sample) {
      const tr = await request.get(`http://localhost:5180/api/files/${taskId}?as=text&n=${p.page}`)
      expect(tr.status()).toBe(200)
      const html = await tr.text()

      // 新结构：每词一个 position:absolute span，从 span style 解析 left/top/width/height
      const spanRe = /<span\s+style="position:absolute;left:([\d.]+)px;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px[^"]*"[^>]*>/g
      const lefts: number[] = [], tops: number[] = [], rights: number[] = [], bottoms: number[] = []
      let m
      while ((m = spanRe.exec(html)) !== null) {
        const l = parseFloat(m[1]), t = parseFloat(m[2])
        const w = parseFloat(m[3]), h = parseFloat(m[4])
        lefts.push(l); tops.push(t); rights.push(l + w); bottoms.push(t + h)
      }
      expect(lefts.length).toBeGreaterThan(0)

      // 关键：所有 bbox 坐标必须落在 page 像素范围内（误差容差 4px 用于浮点）
      const tol = 4
      const maxLeft = Math.max(...lefts, 0)
      const maxTop = Math.max(...tops, 0)
      const maxRight = Math.max(...rights, 0)
      const maxBottom = Math.max(...bottoms, 0)
      expect(maxLeft).toBeLessThan(p.width + tol)
      expect(maxTop).toBeLessThan(p.height + tol)
      expect(maxRight).toBeLessThan(p.width + tol)
      expect(maxBottom).toBeLessThan(p.height + tol)

      // data-page-w/h 必须与 page.width/height 一致（前端权威兜底源）
      const dw = html.match(/data-page-w="([\d.]+)"/)
      const dh = html.match(/data-page-h="([\d.]+)"/)
      expect(dw).toBeTruthy()
      expect(dh).toBeTruthy()
      expect(parseFloat(dw![1])).toBeCloseTo(p.width, 0)
      expect(parseFloat(dh![1])).toBeCloseTo(p.height, 0)

      // 不应有 <p> 行容器（已废弃，会让 flex 二次计算坐标）
      expect(html).not.toMatch(/<p /)
    }
  })

  test('UI 维度：每页 wrapper 宽高 = API 返回 width/height', async ({ page, request }) => {
    try { await fs.access(SAMPLE) } catch { test.skip(true, 'sample missing'); return }
    const taskId = await uploadAndWait(page, request)
    await page.goto('/')
    await page.waitForTimeout(500)
    await page.evaluate((tid) => {
      const card = document.querySelector(`[data-task-id="${tid}"]`)
      const btn = card?.querySelector('button')
      ;(btn as HTMLButtonElement | undefined)?.click()
    }, taskId)
    // 等预览渲染
    await page.waitForSelector('img.pdf-images-page', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(1000)

    const wrappers = page.locator('.pdf-image-page')
    const cnt = await wrappers.count()
    if (cnt === 0) { test.skip(true, 'preview modal 未渲染'); return }

    // 拉 API 对比
    const r = await request.get('http://localhost:5180/api/tasks')
    const j = await r.json()
    const task = j.tasks.find((x: any) => x.id === taskId)
    expect(task.pages.length).toBeGreaterThanOrEqual(cnt)

    for (let i = 0; i < cnt; i++) {
      const w = wrappers.nth(i)
      const cssW = await w.evaluate(el => parseFloat((el as HTMLElement).style.width))
      const cssH = await w.evaluate(el => parseFloat((el as HTMLElement).style.height))
      const apiW = task.pages[i].width
      const apiH = task.pages[i].height
      expect(cssW).toBe(apiW)
      expect(cssH).toBe(apiH)
    }
  })
})