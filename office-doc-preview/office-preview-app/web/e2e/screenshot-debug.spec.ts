import { test } from '@playwright/test'

test('调试：文字层 spans 半透明叠加', async ({ page, request }) => {
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
  await page.waitForTimeout(3000)

  // 注入调试 CSS：把文字层 span 显示成半透明红底
  await page.addStyleTag({
    content: `
      .pdf-text-layer span {
        background: rgba(255, 0, 0, 0.25) !important;
        color: rgba(255, 0, 0, 1) !important;
        outline: 1px solid red !important;
      }
      .pdf-text-layer p {
        outline: 1px dashed blue !important;
      }
    `
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/alignment-debug-overlay.png', fullPage: false })
})
