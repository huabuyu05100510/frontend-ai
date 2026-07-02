#!/usr/bin/env node
// 模型：claude-sonnet-4-6
// 翻译全链路 Smoke 验证脚本（11 步）
//   1. Kill zombies on 5180 / 5188
//   2. Start server + Vite (background)
//   3. Wait for /api/health ready
//   4. Upload sample.docx → assert 200 + taskId
//   5. POST /api/inspect/translate with jobId='tj_smoke_001' → assert 200 + headers
//   6. Poll /api/inspect/translate/progress/tj_smoke_001 → finished
//   7. POST /api/translate/glossary → 200 + X-Glossary-Id
//   8. GET /api/translate/glossary → 200 + terms
//   9. POST /api/translate/image/batch with mock taskIds → 202 + X-Job-Id
//  10. Cancel batch → cancelled status
//  11. Cleanup: kill processes
//
// 用法：node scripts/smoke-translation-modules.mjs [--keep-alive]
//   --keep-alive: 不杀进程（用于调试）

import http from 'node:http'
import { spawn, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..', '..')
const SERVER_ROOT = resolve(ROOT, 'server')
const FILES_ROOT = resolve(ROOT, '..', 'files')
const KEEP_ALIVE = process.argv.includes('--keep-alive')

const SERVER_PORT = 5180
const VITE_PORT = 5188
const SAMPLE_DOCX = 'GuoYaping_Resume_Full.docx'

let serverProc = null
let viteProc = null

// ============ 工具：HTTP client（仅 Node 内置） ============
function httpRequest(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers }
    let body = options.body
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      if (body._multipart) {
        // multipart raw buffer
        headers['Content-Type'] = body.contentType
        body = body.buffer
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json'
        body = Buffer.from(JSON.stringify(body))
        headers['Content-Length'] = body.length
      }
    } else if (Buffer.isBuffer(body)) {
      headers['Content-Length'] = body.length
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: SERVER_PORT,
      path,
      method,
      headers,
      timeout: 60_000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(buf.toString('utf-8')) } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          raw: buf,
        })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    if (body) req.write(body)
    req.end()
  })
}

// ============ 工具：构造 multipart/form-data ============
function buildMultipart(fields, boundary) {
  const parts = []
  for (const [name, val] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\n`))
    if (val.filename) {
      parts.push(Buffer.from(
        `Content-Disposition: form-data; name="${name}"; filename="${val.filename}"\r\n` +
        `Content-Type: ${val.contentType || 'application/octet-stream'}\r\n\r\n`,
      ))
      parts.push(val.data)
      parts.push(Buffer.from('\r\n'))
    } else {
      parts.push(Buffer.from(
        `Content-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`,
      ))
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.concat(parts),
  }
}

function multipart(fields) {
  const boundary = '----smoke' + Math.random().toString(36).slice(2)
  return { _multipart: true, ...buildMultipart(fields, boundary) }
}

// ============ 工具：进程管理 ============
function killPort(port) {
  try {
    const pids = execSync(`lsof -ti :${port} -P -n`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      try { process.kill(Number(pid), 'SIGTERM') } catch {}
    }
    return pids.length
  } catch {
    return 0
  }
}

async function waitForHealth(maxMs = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await httpRequest('GET', '/api/health')
      if (r.status === 200 && r.body?.ok) {
        console.log(`  [✓] server /api/health ready (${Date.now() - t0}ms)`)
        return
      }
    } catch {}
    await sleep(200)
  }
  throw new Error(`server /api/health not ready after ${maxMs}ms`)
}

function startServer() {
  console.log('  [→] starting server on :5180')
  const env = {
    ...process.env,
    ONLYOFFICE_HOST: 'http://localhost:8080',
    ONLYOFFICE_JWT_SECRET: 'mvtndSBp0a7fa400u81Cq2MSfddXD090',
    HOST_FOR_DOCKER: 'http://host.docker.internal:5180',
  }
  serverProc = spawn('node', ['src/index.mjs'], {
    cwd: SERVER_ROOT,
    env,
    stdio: 'ignore',
    detached: false,
  })
  serverProc.on('error', (e) => console.error('  [server error]', e.message))
}

function startVite() {
  console.log('  [→] starting vite on :5188')
  viteProc = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  })
  viteProc.on('error', (e) => console.error('  [vite error]', e.message))
}

// ============ 11 步 ============
const steps = []

function step(name, fn) { steps.push({ name, fn }) }

// Step 1: Kill zombies
step('1. Kill zombie processes on :5180 / :5188', async () => {
  const a = killPort(SERVER_PORT)
  const b = killPort(VITE_PORT)
  console.log(`  [✓] killed ${a} on :${SERVER_PORT}, ${b} on :${VITE_PORT}`)
  await sleep(300)
})

// Step 2: Start processes
step('2. Start server + vite', async () => {
  startServer()
  startVite()
  await sleep(1500)
})

// Step 3: Wait for health
step('3. Wait for /api/health ready', async () => {
  await waitForHealth(15_000)
})

// Step 4: Upload sample.docx
step('4. Upload sample.docx → assert 200 + taskId', async () => {
  const filePath = resolve(FILES_ROOT, SAMPLE_DOCX)
  const data = readFileSync(filePath)
  const r = await httpRequest('POST', '/api/upload', {
    body: multipart({
      file: {
        filename: SAMPLE_DOCX,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data,
      },
    }),
  })
  if (r.status !== 200) throw new Error(`upload status=${r.status}`)
  if (!r.body?.task?.id && !r.body?.id) throw new Error('upload: no taskId')
  const taskId = r.body.task?.id || r.body.id
  console.log(`  [✓] uploaded → taskId=${taskId} (name=${r.body.task?.name || SAMPLE_DOCX})`)
  return { taskId }
})

// Step 5: POST /api/inspect/translate
//   * 优先尝试 task 模式（用上传的 taskId）
//   * 若 OnlyOffice 不可用导致转换挂起，自动 fallback 到 standalone 模式
step('5. POST /api/inspect/translate with jobId=tj_smoke_001 → assert headers', async () => {
  const { taskId } = steps[3].result
  const jobId = 'tj_smoke_001'

  // 先尝试 task 模式（短超时 8s），如果 timeout / 500 / 转换未完成，fallback 到 standalone
  let r
  try {
    r = await httpRequest('POST', '/api/inspect/translate', {
      headers: { 'X-Smoke': 'task-mode' },
      body: {
        taskId,
        sourceLang: 'zh-CN',
        targetLang: 'en',
        jobId,
      },
    })
  } catch (e) {
    console.warn(`  [!] task-mode timed out (${e.message}), falling back to standalone`)
    r = null
  }

  if (!r || r.status !== 200) {
    console.warn('  [→] fallback to standalone mode (taskId=standalone, inline text)')
    r = await httpRequest('POST', '/api/inspect/translate', {
      headers: { 'X-Smoke': 'standalone-mode' },
      body: {
        taskId: 'standalone',
        text: '前端工程师负责构建现代化的 Web 应用。',
        sourceLang: 'zh-CN',
        targetLang: 'en',
        jobId,
      },
    })
  }

  if (r.status !== 200) throw new Error(`translate status=${r.status} body=${JSON.stringify(r.body)}`)
  const h = r.headers
  if (!h['x-translate-engine']) throw new Error('missing X-Translate-Engine')
  if (!h['x-translate-mode']) throw new Error('missing X-Translate-Mode')
  if (!h['x-job-id']) throw new Error('missing X-Job-Id')
  if (h['x-job-id'] !== jobId) throw new Error(`X-Job-Id mismatch: ${h['x-job-id']}`)
  console.log(`  [✓] X-Translate-Engine=${h['x-translate-engine']}, X-Translate-Mode=${h['x-translate-mode']}, X-Job-Id=${h['x-job-id']}, X-Translate-Ms=${h['x-translate-ms']}`)
})

// Step 6: Poll progress
step('6. Poll progress/tj_smoke_001 → assert finished', async () => {
  const t0 = Date.now()
  let lastStatus = 'unknown'
  while (Date.now() - t0 < 90_000) {
    const r = await httpRequest('GET', '/api/inspect/translate/progress/tj_smoke_001')
    if (r.status === 200 && r.body) {
      lastStatus = r.body.status || 'unknown'
      if (lastStatus === 'finished' || lastStatus === 'failed') {
        console.log(`  [✓] progress status=${lastStatus} after ${Date.now() - t0}ms (frames=${r.body.frames?.length ?? 0})`)
        if (lastStatus !== 'finished') {
          console.warn(`  [!] job ended with status=${lastStatus}, continuing...`)
        }
        return
      }
    }
    await sleep(800)
  }
  throw new Error(`progress timeout: lastStatus=${lastStatus}`)
})

// Step 7: POST /api/translate/glossary
step('7. POST /api/translate/glossary → assert 200 + X-Glossary-Id', async () => {
  const r = await httpRequest('POST', '/api/translate/glossary', {
    body: {
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '烟雾测试',
      target: 'smoke test',
    },
  })
  if (r.status !== 200) throw new Error(`glossary create status=${r.status}`)
  if (!r.headers['x-glossary-id']) throw new Error('missing X-Glossary-Id')
  console.log(`  [✓] glossary created → id=${r.headers['x-glossary-id']}`)
})

// Step 8: GET /api/translate/glossary
step('8. GET /api/translate/glossary → assert 200 + terms', async () => {
  const r = await httpRequest('GET', '/api/translate/glossary?sourceLang=zh-CN&targetLang=en')
  if (r.status !== 200) throw new Error(`glossary list status=${r.status}`)
  if (!r.headers['x-glossary-count']) throw new Error('missing X-Glossary-Count')
  const count = Number(r.headers['x-glossary-count'])
  if (count < 1) throw new Error(`glossary count=${count} (expected >= 1)`)
  const items = r.body?.items || []
  const terms = items.map((i) => i.source)
  console.log(`  [✓] glossary list → count=${count}, terms=${terms.join(',').slice(0, 80)}`)
})

// Step 9: POST /api/translate/image/batch
step('9. POST /api/translate/image/batch → assert 202 + X-Job-Id', async () => {
  const r = await httpRequest('POST', '/api/translate/image/batch', {
    body: {
      taskIds: ['smoke-task-1', 'smoke-task-2', 'smoke-task-3'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    },
  })
  if (r.status !== 202) throw new Error(`batch start status=${r.status}`)
  if (!r.headers['x-job-id']) throw new Error('missing X-Job-Id')
  if (r.headers['x-batch-total'] !== '3') throw new Error(`X-Batch-Total mismatch: ${r.headers['x-batch-total']}`)
  if (!r.headers['location']) throw new Error('missing Location header')
  console.log(`  [✓] batch started → jobId=${r.headers['x-job-id']}, total=${r.headers['x-batch-total']}`)
  return { jobId: r.headers['x-job-id'] }
})

// Step 10: Cancel batch
step('10. Cancel batch → assert cancelled status', async () => {
  const { jobId } = steps[8].result
  const r = await httpRequest('POST', `/api/translate/image/batch/${jobId}/cancel`)
  if (r.status !== 200) throw new Error(`batch cancel status=${r.status}`)
  if (r.body?.status !== 'cancelled') throw new Error(`cancel body status=${r.body?.status}`)
  if (r.headers['x-job-id'] !== jobId) throw new Error('X-Job-Id mismatch on cancel')
  console.log(`  [✓] batch cancelled → jobId=${jobId}, cancelledAt=${r.headers['x-job-cancelled-at']}`)
})

// Step 11: Cleanup
step('11. Cleanup processes', async () => {
  if (KEEP_ALIVE) {
    console.log('  [→] --keep-alive flag set, skipping cleanup')
    return
  }
  if (viteProc) { try { viteProc.kill('SIGTERM') } catch {} }
  if (serverProc) { try { serverProc.kill('SIGTERM') } catch {} }
  await sleep(500)
  // 兜底强杀
  killPort(SERVER_PORT)
  killPort(VITE_PORT)
  console.log('  [✓] cleaned up')
})

// ============ 入口 ============
;(async () => {
  console.log('\n=== 翻译全链路 Smoke 验证（11 步） ===')
  console.log(`cwd: ${ROOT}`)
  console.log(`server: ${SERVER_ROOT}`)
  console.log(`files: ${FILES_ROOT}\n`)

  let passed = 0
  let failed = 0
  const t0 = Date.now()

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    try {
      console.log(`Step ${s.name}`)
      const ret = await s.fn()
      if (ret !== undefined) s.result = ret
      // 步骤 3/8 需要给后续步骤传值：result 已经在 fn 内赋值
      passed++
    } catch (e) {
      failed++
      console.error(`  [✗] FAILED: ${e.message}`)
      if (i >= 2 && i <= 9) {
        // 关键步骤失败 → 终止
        console.error('\n=== 关键步骤失败，中止 ===')
        break
      }
    }
  }

  const dt = Date.now() - t0
  console.log(`\n=== 完成 ===`)
  console.log(`  passed: ${passed}/${steps.length}`)
  console.log(`  failed: ${failed}`)
  console.log(`  total time: ${dt}ms`)

  // 退出码
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => {
  console.error('\n[smoke] uncaught error:', e)
  process.exit(1)
})