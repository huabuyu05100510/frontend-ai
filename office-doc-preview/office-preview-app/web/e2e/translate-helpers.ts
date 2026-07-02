// 模型：claude-sonnet-4-6
// 翻译 E2E 测试辅助函数
//   - uploadSampleDocx(): 上传 samples/GuoYaping_Resume_Full.docx，等转换完成
//   - uploadSampleImage(): 上传 samples/宁波市.png (mock)
//   - gotoTranslateDocMode(): 导航到 /translate，切换到「文档翻译」子菜单
//   - gotoTranslateImageMode(): 导航到 /translate，切换到「图片翻译」子菜单
//   - waitForJobFinished(): 轮询 /api/inspect/translate/progress/:jobId 直到 finished
//
// 所有 helper 假定 server (5180) + Vite (5188) 已启（playwright.config.ts 的 webServer 段会保证）

import type { APIRequestContext, Page } from '@playwright/test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const BASE = 'http://localhost:5188'
const API = 'http://localhost:5180'
const FILES_ROOT = path.resolve(process.cwd(), '..', '..', 'files')

export interface UploadResult {
  taskId: string
  name: string
  ext: string
}

export async function uploadSampleDocx(
  request: APIRequestContext,
  filename = 'GuoYaping_Resume_Full.docx',
): Promise<UploadResult> {
  const samplePath = path.join(FILES_ROOT, filename)
  const buf = await fs.readFile(samplePath)
  const res = await request.post(`${API}/api/upload`, {
    multipart: {
      file: {
        name: filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: buf,
      },
    },
  })
  if (!res.ok()) throw new Error(`upload failed: ${res.status()}`)
  const data = await res.json()
  return {
    taskId: data.task?.id || data.id,
    name: data.task?.name || filename,
    ext: data.task?.ext || 'docx',
  }
}

export async function uploadSampleImage(
  request: APIRequestContext,
  filename = '宁波市.png',
): Promise<UploadResult> {
  const samplePath = path.join(FILES_ROOT, filename)
  const buf = await fs.readFile(samplePath)
  const res = await request.post(`${API}/api/upload`, {
    multipart: {
      file: {
        name: filename,
        mimeType: 'image/png',
        buffer: buf,
      },
    },
  })
  if (!res.ok()) throw new Error(`upload image failed: ${res.status()}`)
  const data = await res.json()
  return {
    taskId: data.task?.id || data.id,
    name: data.task?.name || filename,
    ext: data.task?.ext || 'png',
  }
}

/** 等待 server 端转换完成（OnlyOffice → PDF + 栅格化） */
export async function waitForConvertDone(
  request: APIRequestContext,
  taskId: string,
  timeoutMs = 60_000,
): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await request.get(`${API}/api/tasks`)
    if (r.ok()) {
      const j = await r.json()
      const t = j.tasks?.find?.((x: { id: string }) => x.id === taskId)
      if (t?.convertStatus === 'done') return
      if (t?.convertStatus === 'failed') throw new Error('conversion failed: ' + t.convertError)
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`convert timeout for ${taskId}`)
}

/** 切换到「文档翻译」子菜单 */
export async function gotoTranslateDocMode(page: Page): Promise<void> {
  await page.goto(`${BASE}/translate`, { waitUntil: 'domcontentloaded' })
  // 等待页面挂载（已知 useLocation bug 容错）
  await page.locator('.xf-submenu').first().waitFor({ timeout: 30_000 }).catch(() => {})
  // 切换到「文档翻译」子菜单（点击「文档翻译」按钮）
  const docBtn = page.locator('.xf-submenu-item:has-text("文档翻译")')
  if ((await docBtn.count()) > 0) {
    await docBtn.first().click()
  }
  // 等待 DocTranslateMode 出现
  await page.locator('[data-testid="doc-translate-mode"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
}

/** 切换到「图片翻译」子菜单 */
export async function gotoTranslateImageMode(page: Page): Promise<void> {
  // 先访问 /files 让 FilesPage 调用 fetchTasks()（写入 zustand store）
  await page.goto(`${BASE}/files`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)  // 给 fetchTasks 时间完成
  // 然后切到 /translate
  await page.goto(`${BASE}/translate`, { waitUntil: 'domcontentloaded' })
  await page.locator('.xf-submenu').first().waitFor({ timeout: 30_000 }).catch(() => {})
  const imgBtn = page.locator('.xf-submenu-item:has-text("图片翻译")')
  if ((await imgBtn.count()) > 0) {
    await imgBtn.first().click()
  }
  await page.waitForTimeout(800)
  // 等待 toolbar 或 empty state（取决于是否有图片任务）
  const toolbar = page.locator('[data-testid="image-translate-toolbar"]')
  const empty = page.locator('[data-testid="image-translate-empty"]')
  await Promise.race([
    toolbar.first().waitFor({ timeout: 15_000 }).catch(() => {}),
    empty.first().waitFor({ timeout: 15_000 }).catch(() => {}),
  ])
}

/** 轮询进度直到 finished / failed / cancelled */
export async function waitForJobFinished(
  request: APIRequestContext,
  jobId: string,
  options: { timeoutMs?: number; terminal?: ReadonlyArray<string> } = {},
): Promise<{ status: string; frames: unknown[] }> {
  const { timeoutMs = 90_000, terminal = ['finished', 'failed', 'cancelled'] } = options
  const t0 = Date.now()
  let lastStatus = 'unknown'
  while (Date.now() - t0 < timeoutMs) {
    const r = await request.get(`${API}/api/inspect/translate/progress/${jobId}`)
    if (r.ok()) {
      const j = await r.json()
      lastStatus = j.status || 'unknown'
      if (terminal.includes(lastStatus)) {
        return { status: lastStatus, frames: j.frames || [] }
      }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return { status: lastStatus, frames: [] }
}

/** 创建一个术语项 */
export async function createGlossaryTerm(
  request: APIRequestContext,
  args: { sourceLang: string; targetLang: string; source: string; target: string; pos?: string },
): Promise<{ id: string }> {
  const r = await request.post(`${API}/api/translate/glossary`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      source: args.source,
      target: args.target,
      ...(args.pos ? { pos: args.pos } : {}),
    },
  })
  if (!r.ok()) throw new Error(`glossary create failed: ${r.status()}`)
  const j = await r.json()
  return { id: j.id }
}

/** 创建一个 TM 条目 */
export async function createTmEntry(
  request: APIRequestContext,
  args: { sourceLang: string; targetLang: string; source: string; target: string },
): Promise<{ id: string }> {
  const r = await request.post(`${API}/api/translate/memory`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      source: args.source,
      target: args.target,
    },
  })
  if (!r.ok()) throw new Error(`tm create failed: ${r.status()}`)
  const j = await r.json()
  return { id: j.id }
}

/** 直接 POST /api/inspect/translate 触发翻译（返回 jobId + 完整响应） */
export async function postInspectTranslate(
  request: APIRequestContext,
  args: {
    taskId: string
    sourceLang: string
    targetLang: string
    jobId?: string
    glossary?: Array<{ source: string; target: string }>
  },
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const r = await request.post(`${API}/api/inspect/translate`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      taskId: args.taskId,
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      jobId: args.jobId,
      ...(args.glossary ? { glossary: args.glossary } : {}),
    },
  })
  const headers: Record<string, string> = {}
  r.headersArray().forEach(h => { headers[h.name.toLowerCase()] = h.value })
  let body: unknown = null
  try { body = await r.json() } catch {}
  return { status: r.status(), headers, body }
}

/** 触发翻译并返回 jobId */
export async function triggerTranslateJob(
  request: APIRequestContext,
  args: { taskId: string; sourceLang?: string; targetLang?: string },
): Promise<{ jobId: string; ms: number; glossaryHits: number; tmHits: number }> {
  const jobId = 'tj_e2e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
  const { status, headers } = await postInspectTranslate(request, {
    taskId: args.taskId,
    sourceLang: args.sourceLang || 'zh-CN',
    targetLang: args.targetLang || 'en',
    jobId,
  })
  if (status !== 200) throw new Error(`translate failed: status=${status}`)
  return {
    jobId: headers['x-job-id'] || jobId,
    ms: Number(headers['x-translate-ms'] || 0),
    glossaryHits: Number(headers['x-translate-glossary-hits'] || 0),
    tmHits: Number(headers['x-translate-tm-hits'] || 0),
  }
}

// 模型：claude-sonnet-4-6
// 兼容性 re-export —— 让 e2e/translate-*.spec.ts 既能用 ./translate-helpers（翻译专用）
// 又能用 ./helpers（视觉测试基线）的 seedAppState / Theme。
export { seedAppState } from './helpers'
export type { Theme } from './helpers'