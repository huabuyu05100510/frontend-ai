import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('console', m => { if (m.type() === 'error') console.log(`[ERR]`, m.text().slice(0, 200)) })

await page.goto('http://localhost:5180/')
await page.waitForTimeout(5000)

// 用 API 直接拿任务，转到 docx 任务 ID
const docxId = 't_mqm3x5we55670b6a'  // 郭亚平_前端_03(1).docx, 3 pages, 992x1403
// 模拟从任务列表点击
await page.evaluate(async (id) => {
  const r = await fetch(`/api/files/${id}?as=text&n=1`)
  return r.status
}, docxId)
console.log('text API 状态:', await page.evaluate(async (id) => (await fetch(`/api/files/${id}?as=text&n=1`)).status, docxId))

// 注入 task 到 store 并打开预览（绕过 UI 列表）
await page.goto('http://localhost:5180/')
await page.waitForTimeout(2000)
// 通过 API 拿数据
const taskData = await fetch(`http://localhost:3210/api/tasks`).then(r => r.json())
const docx = taskData.tasks.find(t => t.id === docxId)
console.log('docx 任务:', docx.name, 'pages:', docx.pages.length, 'page 1:', docx.pages[0])

// 通过 page eval 注入
await page.evaluate((task) => {
  // 模拟直接打开 modal：调用 React state setter（不容易）
  // 改用文件 URL
  window.__testTask = task
}, docx)

console.log('任务数据准备完毕，建议直接 goto 文件 URL 测试')
await browser.close()
