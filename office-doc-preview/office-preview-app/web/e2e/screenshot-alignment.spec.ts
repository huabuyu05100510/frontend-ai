// 截图验证：文字层对齐（行级 vs word 级对比）
import { test } from '@playwright/test'

test('截图：文字对齐 (line-based)', async ({ page, request }) => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const sample = path.resolve(process.cwd(), '..', '..', 'files', 'GuoYaping_Resume_Full.docx')
  const buf = await fs.readFile(sample)
  const r = await request.post('http://localhost:5180/api/upload', {
    multipart: { file: { name: 'GuoYaping_Resume_Full.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf } }
  })
  const { task } = await r.json()
  for (let i = 0; i < 60; i++) {
    const tr = await request.get('http://localhost:5180/api/tasks')
    const tj = await tr.json()
    const t = tj.tasks.find((x: any) => x.id === task.id)
    if (t?.convertStatus === 'done') break
    await page.waitForTimeout(1000)
  }
  await page.goto('/')
  await page.waitForTimeout(500)
  await page.locator(`button:has-text("预览")`).first().click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'test-results/alignment-line-based.png', fullPage: false })
})