// 路由分发：上传 / 任务列表 / 单任务 / 文件服务（含 Range）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG, MIME, extOf, mimeOf, strategyOf } from './config.mjs'
import { listTasks, getTask, upsertTask, updateTask, loadTasks } from './store.mjs'
import { parseMultipart, readBody } from './multipart.mjs'
import { enqueueConvert } from './converter.mjs'
import { ensureLinearized } from './pdf-optimize.mjs'

function sendJSON(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, ETag')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.writeHead(code)
  res.end(JSON.stringify(data))
}

function uid() {
  return 't_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
}

// 文件大小人类可读
function humanSize(n) {
  if (!n && n !== 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

// 创建任务并落盘原文件
export function createTaskFromFile({ name, size, mtime, ext, strategy, originalPath }) {
  const id = uid()
  const now = Date.now()
  const task = {
    id,
    name,
    size,
    ext,
    mime: mimeOf(name),
    strategy,
    originalPath: originalPath || null,        // 仅扫描导入的样本在用
    originalUrl: `/api/files/${id}?as=original`,
    previewUrl: null,
    previewExt: null,
    convertStatus: strategy === 'convert_pdf' ? 'pending' : 'done',
    status: 'ready',
    createdAt: now,
    updatedAt: now
  }
  if (strategy === 'frontend') {
    // 直接用原文件作为预览源
    task.previewUrl = task.originalUrl
    task.previewExt = ext
  }
  // 前端 PDF：异步线性化，让 pdf.js 流式秒开（不变更策略）
  if (strategy === 'frontend' && ext === 'pdf') {
    ensureLinearized(task, originalPath || task.originalPath)
      .then(linPath => {
        if (linPath && linPath !== (originalPath || task.originalPath)) {
          updateTask(task.id, {
            previewPath: linPath,
            previewUrl: `/api/files/${task.id}?as=preview`,
            previewExt: 'pdf'
          })
        }
      })
      .catch(e => console.warn('[scan] linearize failed', task.name, e.message))
  }
  upsertTask(task)
  return task
}

// 复制/移动外部文件到 upload 目录（扫描导入用）
export function importExternalFile(absPath, { copy = true } = {}) {
  const stat = fs.statSync(absPath)
  const name = path.basename(absPath)
  const ext = extOf(name)
  const strategy = strategyOf(ext)
  if (strategy === 'unsupported') return null
  const id = uid()
  const dest = path.join(CONFIG.UPLOAD_DIR, id + '_' + name)
  if (copy) fs.copyFileSync(absPath, dest)
  else fs.renameSync(absPath, dest)
  return createTaskFromFile({
    name, size: stat.size, mtime: stat.mtimeMs, ext, strategy, originalPath: dest
  })
}

// 扫描预置样本目录，幂等导入
export function scanSamples() {
  if (!fs.existsSync(CONFIG.SAMPLES_DIR)) {
    console.log(`[scan] 样本目录不存在: ${CONFIG.SAMPLES_DIR}`)
    return 0
  }
  loadTasks()
  const existingNames = new Set(listTasks().map(t => t.name))
  let count = 0
  for (const entry of fs.readdirSync(CONFIG.SAMPLES_DIR)) {
    if (entry.startsWith('.')) continue
    const abs = path.join(CONFIG.SAMPLES_DIR, entry)
    if (!fs.statSync(abs).isFile()) continue
    if (existingNames.has(entry)) continue
    const ext = extOf(entry)
    const strategy = strategyOf(ext)
    if (strategy === 'unsupported') {
      console.log(`[scan] 跳过不支持的格式: ${entry}`)
      continue
    }
    const task = importExternalFile(abs, { copy: true })
    if (task) {
      count++
      console.log(`[scan] 导入样本: ${entry} → ${task.id} [${strategy}]`)
      if (strategy === 'convert_pdf') enqueueConvert(task, task.originalPath)
    }
  }
  return count
}

// 处理 multipart 上传：用已验证的 readBody + parseMultipart（正确性优先）
async function handleUpload(req, res) {
  try {
    const declaredCL = Number(req.headers['content-length'] || 0)
    const body = await readBody(req, CONFIG.MAX_FILE_SIZE)
    const ct = req.headers['content-type'] || ''
    const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundaryMatch) return sendJSON(res, 400, { error: 'no boundary' })
    const fields = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2])
    const file = fields.file
    if (!file || !file.filename) return sendJSON(res, 400, { error: 'missing file' })

    const name = file.filename
    const ext = extOf(name)
    const strategy = strategyOf(ext)
    // 上传完整性诊断日志
    console.log(`[upload] ${name} | 声明CL=${declaredCL} 实际body=${body.length} 文件data=${file.data.length} | ${strategy}`)
    if (strategy === 'unsupported') return sendJSON(res, 415, { error: `unsupported format: .${ext}` })

    const id = uid()
    const dest = path.join(CONFIG.UPLOAD_DIR, id + '_' + name)
    fs.writeFileSync(dest, file.data)

    const task = createTaskFromFile({ name, size: file.data.length, ext, strategy, originalPath: dest })
    if (strategy === 'convert_pdf') enqueueConvert(task, dest)
    return sendJSON(res, 200, { ok: true, task })
  } catch (e) {
    return sendJSON(res, e.message === 'FILE_TOO_LARGE' ? 413 : 500, { error: e.message })
  }
}

// 文件服务（含 Range 支持，对音视频流畅拖动至关重要）
function serveFile(req, res, filePath, filename) {
  if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'file not found' })
  const stat = fs.statSync(filePath)
  const total = stat.size
  const range = req.headers['range']
  const type = mimeOf(filename)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  res.setHeader('ETag', `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`)
  if (filename) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : total - 1
      if (end >= total) end = total - 1
      if (start > end) start = end
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, { 'Content-Length': total })
  fs.createReadStream(filePath).pipe(res)
}

export async function route(req, res) {
  const url = new URL(req.url, CONFIG.HOST)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {})
    return
  }

  // 健康检查
  if (pathname === '/api/health') return sendJSON(res, 200, { ok: true, t: Date.now() })

  // 扫描样本（开发期手动触发）
  if (pathname === '/api/scan' && req.method === 'POST') {
    const n = scanSamples()
    return sendJSON(res, 200, { ok: true, imported: n })
  }

  // 任务列表（剔除内部文件系统路径，避免信息泄漏）
  if (pathname === '/api/tasks' && req.method === 'GET') {
    const safe = listTasks().map(t => {
      const { originalPath, previewPath, ...rest } = t
      return rest
    })
    return sendJSON(res, 200, { tasks: safe })
  }

  // 上传（流式）
  if (pathname === '/api/upload' && req.method === 'POST') {
    return await handleUpload(req, res)
  }

  // 文件服务 /api/files/:id?as=original|preview
  const m = pathname.match(/^\/api\/files\/([\w-]+)$/)
  if (m && req.method === 'GET') {
    const id = m[1]
    const as = url.searchParams.get('as') || 'preview'
    const task = getTask(id)
    if (!task) return sendJSON(res, 404, { error: 'task not found' })
    const filePath = as === 'original' ? task.originalPath : task.previewPath || task.originalPath
    const filename = as === 'original' ? task.name : `${task.name}.${task.previewExt || task.ext}`
    return serveFile(req, res, filePath, filename)
  }

  sendJSON(res, 404, { error: 'not found', path: pathname })
}
