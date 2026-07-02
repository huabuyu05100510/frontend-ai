// E2E smoke: 任务列表渲染 + 上传后缩略图/页面产物可访问
// 跑前确保 server (5180) + OnlyOffice (8080) + Vite (5188) 已启
import { test, expect } from '@playwright/test'

test.describe('Office 文档预览端到端', () => {
  test('首页加载 + 任务列表渲染', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header, .app-header, h1').first()).toBeVisible({ timeout: 10_000 })
    // 标题或 app 名存在
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })

  test('原生 PDF 上传后预览按钮可点击', async ({ page, request }) => {
    await page.goto('/')
    // 等任务列表加载完
    await page.waitForTimeout(500)

    // 通过 API 直接上传一份样本 PDF（蘑菇书） 模拟"已有 PDF 任务" 的最简链路
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const samplePath = path.resolve(process.cwd(), '..', '..', 'files', 'GuoYaping_Resume_Full.docx')
    const buf = await fs.readFile(samplePath)
    const res = await request.post('http://localhost:5180/api/upload', {
      multipart: {
        file: { name: 'GuoYaping_Resume_Full.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf }
      }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    const taskId = data.task.id

    // 等任务完成（OnlyOffice 转换 + 服务端栅格化）
    for (let i = 0; i < 60; i++) {
      const r = await request.get(`http://localhost:5180/api/tasks`)
      const j = await r.json()
      const t = j.tasks.find((x: any) => x.id === taskId)
      if (t?.convertStatus === 'done') break
      if (t?.convertStatus === 'failed') throw new Error('conversion failed: ' + t.convertError)
      await page.waitForTimeout(1000)
    }

    // 缩略图 endpoint 可访问
    const thumbRes = await request.get(`http://localhost:5180/api/files/${taskId}?as=thumb`)
    expect(thumbRes.ok()).toBeTruthy()
    expect(thumbRes.headers()['content-type']).toBe('image/png')

    // 第一页 endpoint 可访问
    const page1Res = await request.get(`http://localhost:5180/api/files/${taskId}?as=page&n=1`)
    expect(page1Res.ok()).toBeTruthy()
    expect(page1Res.headers()['content-type']).toBe('image/png')

    // 路径穿越被拒绝
    const badRes = await request.get(`http://localhost:5180/api/files/${taskId}?as=page&n=../../etc/passwd`, { failOnStatusCode: false })
    expect(badRes.status()).toBe(400)

    // 预览页可加载
    const previewRes = await request.get(`http://localhost:5180/api/files/${taskId}?as=preview`)
    expect(previewRes.ok()).toBeTruthy()
    expect(previewRes.headers()['content-type']).toBe('application/pdf')
  })
})