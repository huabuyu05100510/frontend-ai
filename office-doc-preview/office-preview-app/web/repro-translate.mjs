import { chromium } from '@playwright/test'
import * as fs from 'node:fs/promises'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

page.on('console', msg => {
  const t = msg.text()
  if (t.includes('translate-ui') || t.includes('translate ') || t.includes('[translate')) {
    console.log(`[console]`, t.slice(0, 200))
  }
})
page.on('pageerror', err => console.log('[pageerror]', err.message))

// Upload docx via API
const samplePath = '/Users/didi/Downloads/前端AI/office-doc-preview/files/GuoYaping_Resume_Full.docx'
const buf = await fs.readFile(samplePath)
const upload = await page.request.post('http://localhost:5180/api/upload', {
  multipart: {
    file: {
      name: 'GuoYaping_Resume_Full.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: buf,
    },
  },
})
const uploadData = await upload.json()
const taskId = uploadData.task?.id
console.log('Uploaded:', taskId, 'convertStatus=', uploadData.task?.convertStatus)

// Wait for convert done
const t0 = Date.now()
while (Date.now() - t0 < 60000) {
  await new Promise(r => setTimeout(r, 500))
  const r = await page.request.get('http://localhost:5180/api/tasks')
  const j = await r.json()
  const t = j.tasks?.find?.(x => x.id === taskId)
  if (t?.convertStatus === 'done') break
  if (t?.convertStatus === 'failed') { console.log('convert failed:', t.convertError); break }
}
console.log('Conversion done')

// Go to translate (directly, no /files)
await page.goto('http://localhost:5188/translate', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.locator('.xf-submenu-item:has-text("文档翻译")').click()
await page.waitForTimeout(800)

// Verify task dropdown appears
const select = page.locator('[data-testid="oa-doc-stage-task-select"]')
const visible = await select.isVisible().catch(() => false)
console.log('Task select visible:', visible)
if (visible) {
  await select.selectOption(taskId)
  await page.waitForTimeout(300)
  // Click 开始翻译
  await page.locator('[data-testid="oa-doc-stage-start"]').click()
  console.log('Clicked start')
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000)
    const stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage'))
    const errVisible = await page.locator('[data-testid="oa-doc-stage-error"]').isVisible().catch(() => false)
    const errText = errVisible ? await page.locator('[data-testid="oa-doc-stage-error"]').textContent() : null
    console.log(`[t=${i}s] stage=${stage} error=${errText}`)
    if (stage === 'review' || stage === 'export') break
    if (i === 8) await page.screenshot({ path: '/tmp/during-translate-8s.png' })
  }
  await page.screenshot({ path: '/tmp/after-translate.png' })
}

await browser.close()
