// E2E: 验证 PDF / 图片+文字 模式切换
import { test, expect } from '@playwright/test'

test('PDF / 图片+文字 模式按钮可切换且持久化', async ({ page, request }) => {
  // 上传 docx 触发转换
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const sample = path.resolve(process.cwd(), '..', '..', 'files', 'GuoYaping_Resume_Full.docx')
  const buf = await fs.readFile(sample)
  const r = await request.post('http://localhost:5180/api/upload', {
    multipart: { file: { name: 'GuoYaping_Resume_Full.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf } }
  })
  const { task } = await r.json()

  // 等转换完成
  for (let i = 0; i < 60; i++) {
    const tr = await request.get(`http://localhost:5180/api/tasks`)
    const tj = await tr.json()
    const t = tj.tasks.find((x: any) => x.id === task.id)
    if (t?.convertStatus === 'done') break
    await page.waitForTimeout(1000)
  }

  await page.goto('/')
  await page.waitForTimeout(500)
  await page.locator(`button:has-text("预览")`).first().click()

  const pdfBtn = page.locator('button:has-text("PDF 模式")')
  const imgBtn = page.locator('button:has-text("图片+文字")')
  await expect(pdfBtn).toBeVisible()
  await expect(imgBtn).toBeVisible()

  // 默认应该是图片+文字模式
  await expect(imgBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('img.pdf-images-page').first()).toBeVisible({ timeout: 5000 })
  // 文字层：包含中文（郭亚平）
  await expect(page.locator('.pdf-text-layer').first()).toBeVisible({ timeout: 5000 })

  // 切换到 PDF 模式
  await pdfBtn.click()
  await page.waitForTimeout(500)
  await expect(pdfBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 5000 })

  // 关闭模态，重新打开 — 持久化检查
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.locator(`button:has-text("预览")`).first().click()
  await expect(page.locator('button:has-text("PDF 模式")')).toHaveAttribute('aria-pressed', 'true')
})