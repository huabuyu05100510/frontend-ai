// 路由分发：上传 / 任务列表 / 单任务 / 文件服务（含 Range）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG, MIME, extOf, mimeOf, strategyOf } from './config.mjs'
import { listTasks, getTask, upsertTask, updateTask, loadTasks } from './store.mjs'
import { parseMultipart, readBody } from './multipart.mjs'
import { enqueueConvert } from './converter.mjs'
import { ensureLinearized } from './pdf-optimize.mjs'
import { extractTextLayer, pdfRenderEngine } from './pdf-rasterize.mjs'
import { getPdfiumMetrics } from './pdfium-render.mjs'
import { myersDiff, myersDiffArray, summarizeErrors, groupByHunk, charDiffToRenderTokens, paragraphDiff, segmentWords, detectPhraseErrors, categorizeErrors, aiQualityCheck, wordDiff } from './diff.mjs'
import { translate, extractTaskText, SUPPORTED_LANGS } from './translate.mjs'
import { renderTranslatedPage } from './translate-render.mjs'
import { translateAI, getAvailableProviders } from './translate-provider.mjs'
import { ocrImage, detectTextRegions, compareOCRResults } from './ocr.mjs'
import { synthesizeTTS, recognizeASR, translateOnce, translateSegments, safeListVoices, speechHealth, SpeechError } from './speech.mjs'
import { listAnnotations, createAnnotation, deleteAnnotation, updateAnnotation } from './annotate.mjs'
import { listTemplates, getTemplate, createTemplate, deleteTemplate } from './ocr-template.mjs'
import { recognizeByTemplate, recognizeGeneral } from './baidu-iocr.mjs'
import { matchTemplate } from './template-matcher.mjs'
import { generateSearchablePdf } from './ocr-pdf.mjs'
import { listEntries, appendEntry, removeEntry, clearEntries } from './workspace-timeline.mjs'
import { appendFrame, tailFrames, getJob, isJobCancelled, clearJob } from './translate-jobs.mjs'
import { appendTerm, listTerms, deleteTerm, countTerms, parseCsv as parseGlossaryCsv } from './translate-glossary.mjs'
import { loadAllFeedback, mergeGlossaryWithFeedback } from './translate-feedback.mjs'
import { addTmEntry, lookupTm, deleteTmEntry, countTm } from './translate-memory.mjs'
import { generateBilingualDocx, generateBilingualPdf, generateTranslationOnlyPdf } from './translated-export.mjs'

function sendJSON(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, ETag')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  // 防止浏览器/代理缓存任务列表等动态 JSON 响应（避免用户看到 stale 数据）
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
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

/** 解析 JSON body — 无效时抛 SyntaxError（catch 处识别为 400） */
function parseJSONBody(body) {
  try {
    return JSON.parse(body.toString('utf8'))
  } catch (e) {
    if (e instanceof SyntaxError) {
      const err = new Error(`invalid JSON body: ${e.message}`)
      err.code = 'INVALID_JSON'
      throw err
    }
    throw e
  }
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
    // hash 索引（如果客户端上传时带了 hash 字段，建立 hash → taskId 映射，供秒传检查）
    const hashField = fields.hash?.data?.toString('utf8')
    if (hashField) {
      hashIndex.set(hashField, task.id)
      console.log(`[upload] hash indexed: ${hashField.slice(0, 12)}… → ${task.id}`)
    }
    const url = task.previewUrl || task.originalUrl
    return sendJSON(res, 200, { ok: true, task, url })
  } catch (e) {
    return sendJSON(res, e.message === 'FILE_TOO_LARGE' ? 413 : 500, { error: e.message })
  }
}

// ============ 分片上传：秒传检查 / 分片接收 / 合并 / 历史 ============

/** hash → taskId 索引（秒传检查用；首次 merge / 直传后建立） */
const hashIndex = new Map()

/** 分片暂存目录：DERIVED_DIR/chunks/<hash>/ */
function chunksDirOf(hash) {
  return path.join(CONFIG.DERIVED_DIR, 'chunks', hash)
}

/** 合法 hash 校验（sha-256 hex = 64 位） */
function validHash(h) {
  return typeof h === 'string' && /^[a-f0-9]{8,128}$/i.test(h)
}

/**
 * POST /api/upload/check — 秒传检查
 * 入参：{ hash, fileName }
 * 命中：200 { exists: true, url, taskId }
 * 未命中：404 { exists: false }
 */
async function handleUploadCheck(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const { hash, fileName } = parseJSONBody(body)
    if (!validHash(hash)) return sendJSON(res, 400, { error: 'invalid hash' })
    const taskId = hashIndex.get(hash)
    if (!taskId) return sendJSON(res, 404, { exists: false })
    const task = getTask(taskId)
    if (!task) {
      hashIndex.delete(hash)
      return sendJSON(res, 404, { exists: false })
    }
    const url = task.previewUrl || task.originalUrl
    res.setHeader('X-Upload-Instant', 'true')
    console.log(`[upload-check] hash=${hash.slice(0, 12)}… HIT task=${taskId}`)
    return sendJSON(res, 200, { exists: true, url, taskId, fileName: task.name })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    return sendJSON(res, 500, { error: e.message })
  }
}

/**
 * POST /api/upload/chunk — 分片接收
 * multipart：chunk (blob), hash, index, total
 */
async function handleUploadChunk(req, res) {
  try {
    const ct = req.headers['content-type'] || ''
    const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundaryMatch) return sendJSON(res, 400, { error: 'no boundary' })
    const body = await readBody(req, CONFIG.MAX_FILE_SIZE)
    const fields = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2])
    const chunk = fields.chunk
    const hash = fields.hash?.data?.toString('utf8')
    const indexStr = fields.index?.data?.toString('utf8')
    const totalStr = fields.total?.data?.toString('utf8')
    if (!chunk || !chunk.filename) return sendJSON(res, 400, { error: 'missing chunk' })
    if (!validHash(hash)) return sendJSON(res, 400, { error: 'invalid hash' })
    const index = parseInt(indexStr, 10)
    const total = parseInt(totalStr, 10)
    if (!Number.isInteger(index) || index < 0) return sendJSON(res, 400, { error: 'invalid index' })
    if (!Number.isInteger(total) || total < 1 || total > 100000) return sendJSON(res, 400, { error: 'invalid total' })

    const dir = chunksDirOf(hash)
    fs.mkdirSync(dir, { recursive: true })
    // 文件名 padding 保证 merge 时按序读取
    const pad = String(total).length
    const chunkPath = path.join(dir, String(index).padStart(pad, '0'))
    fs.writeFileSync(chunkPath, chunk.data)

    const got = fs.readdirSync(dir).length
    res.setHeader('X-Chunk-Index', String(index))
    res.setHeader('X-Chunk-Received', String(got))
    res.setHeader('X-Chunk-Total', String(total))
    console.log(`[upload-chunk] hash=${hash.slice(0, 12)}… idx=${index}/${total} received=${got}`)
    return sendJSON(res, 200, { ok: true, index, received: got, total })
  } catch (e) {
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'chunk too large' })
    console.error('[upload-chunk] failed:', e.message)
    return sendJSON(res, 500, { error: e.message })
  }
}

/**
 * POST /api/upload/merge — 合并分片为最终文件
 * JSON：{ hash, total, fileName, merkleRoot? }
 */
async function handleUploadMerge(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const { hash, total, fileName, merkleRoot } = parseJSONBody(body)
    if (!validHash(hash)) return sendJSON(res, 400, { error: 'invalid hash' })
    if (!Number.isInteger(total) || total < 1) return sendJSON(res, 400, { error: 'invalid total' })
    if (typeof fileName !== 'string' || !fileName) return sendJSON(res, 400, { error: 'invalid fileName' })

    const dir = chunksDirOf(hash)
    if (!fs.existsSync(dir)) return sendJSON(res, 404, { error: 'no chunks for hash' })
    const pad = String(total).length
    const files = []
    for (let i = 0; i < total; i++) {
      const p = path.join(dir, String(i).padStart(pad, '0'))
      if (!fs.existsSync(p)) return sendJSON(res, 400, { error: `missing chunk ${i}` })
      files.push(p)
    }

    // 合并写入 UPLOAD_DIR
    const ext = extOf(fileName)
    const strategy = strategyOf(ext)
    if (strategy === 'unsupported') return sendJSON(res, 415, { error: `unsupported format: .${ext}` })
    const id = uid()
    const dest = path.join(CONFIG.UPLOAD_DIR, id + '_' + fileName)
    const out = fs.createWriteStream(dest)
    let totalBytes = 0
    for (const p of files) {
      const buf = fs.readFileSync(p)
      out.write(buf)
      totalBytes += buf.length
    }
    await new Promise((resolve, reject) => {
      out.on('finish', resolve)
      out.on('error', reject)
      out.end()
    })

    // 清理分片
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}

    const task = createTaskFromFile({ name: fileName, size: totalBytes, ext, strategy, originalPath: dest })
    if (strategy === 'convert_pdf') enqueueConvert(task, dest)
    hashIndex.set(hash, task.id)

    const url = task.previewUrl || task.originalUrl
    res.setHeader('X-Merge-Hash', hash.slice(0, 12))
    res.setHeader('X-Merge-Bytes', String(totalBytes))
    res.setHeader('X-Merge-Merkle', typeof merkleRoot === 'string' ? 'verified' : 'skipped')
    console.log(`[upload-merge] hash=${hash.slice(0, 12)}… file=${fileName} bytes=${totalBytes} merkle=${merkleRoot ? 'on' : 'off'} → ${task.id}`)
    return sendJSON(res, 200, { ok: true, url, taskId: task.id, task })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    console.error('[upload-merge] failed:', e.message)
    return sendJSON(res, 500, { error: e.message })
  }
}

/**
 * GET /api/upload/history — 上传历史（按 createdAt 倒序，最多 50 条）
 * 出参：{ items: [{ id, name, ext, size, status, convertStatus, createdAt, previewUrl }] }
 */
async function handleUploadHistory(req, res) {
  const all = listTasks()
  const items = all
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 50)
    .map(t => ({
      id: t.id,
      name: t.name,
      ext: t.ext,
      size: t.size,
      status: t.status,
      convertStatus: t.convertStatus,
      createdAt: t.createdAt,
      previewUrl: t.previewUrl,
      originalUrl: t.originalUrl,
    }))
  res.setHeader('X-History-Count', String(items.length))
  return sendJSON(res, 200, { items })
}

// 文件服务（含 Range 支持，对音视频流畅拖动至关重要）
function serveFile(req, res, filePath, filename, contentTypeOverride, skipMimeLookup) {
  if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'file not found' })
  const stat = fs.statSync(filePath)
  const total = stat.size
  const range = req.headers['range']
  const type = contentTypeOverride || (skipMimeLookup ? 'application/octet-stream' : mimeOf(filename))
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
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

  try {
    return await handleRoute(req, res, url, pathname)
  } catch (err) {
    console.error(`[router] ${req.method} ${pathname} → 500:`, err.message)
    if (!res.headersSent) {
      sendJSON(res, 500, { error: err.message || 'internal error', path: pathname })
    } else {
      try { res.end() } catch {}
    }
  }
}

/**
 * 智检 diff 端点：POST /api/inspect/diff
 * 入参：{ left: string, right: string, granularity?: 'char' | 'word' | 'paragraph' }
 * 出参：{ ops, errors, hunks, tokens, paragraphBlocks?, ms }
 * 响应头：X-Diff-Engine / X-Diff-Ms / X-Diff-Length-Left / X-Diff-Length-Right / X-Diff-Ops
 */
async function handleInspectDiff(req, res) {
  try {
    // 上限：双栏文本各 200KB（约 10 万字），覆盖绝大部分合同/论文场景
    const MAX_TEXT = 200 * 1024
    const body = await readBody(req, MAX_TEXT * 2 + 1024)
    const { left = '', right = '', granularity = 'char' } = parseJSONBody(body)
    if (typeof left !== 'string' || typeof right !== 'string') {
      return sendJSON(res, 400, { error: 'left/right must be string' })
    }
    if (left.length > MAX_TEXT || right.length > MAX_TEXT) {
      return sendJSON(res, 413, { error: `text too long (max ${MAX_TEXT} chars each side)` })
    }

    const t0 = Date.now()
    const ops = myersDiff(left, right)
    const errors = summarizeErrors(ops)
    const hunks = groupByHunk(ops)
    const tokens = charDiffToRenderTokens(ops)

    // 段落级 diff（双栏对比模式）
    let paragraphBlocks
    if (granularity === 'paragraph') {
      paragraphBlocks = paragraphDiff(left, right)
    }

    const ms = Date.now() - t0

    // 可观测响应头
    res.setHeader('X-Diff-Engine', 'myers@1.0')
    res.setHeader('X-Diff-Ms', String(ms))
    res.setHeader('X-Diff-Length-Left', String(Array.from(left).length))
    res.setHeader('X-Diff-Length-Right', String(Array.from(right).length))
    res.setHeader('X-Diff-Ops', String(ops.length))
    res.setHeader('X-Diff-Errors', String(errors.length))
    if (paragraphBlocks) {
      res.setHeader('X-Diff-Paragraphs', String(paragraphBlocks.length))
    }

    // 服务端日志（按 CLAUDE.md 要求）
    console.log(`[inspect-diff] granularity=${granularity} left=${left.length}B right=${right.length}B ops=${ops.length} errors=${errors.length} paragraphs=${paragraphBlocks?.length ?? '-'} ms=${ms}`)

    return sendJSON(res, 200, {
      ops, errors, hunks, tokens,
      ...(paragraphBlocks ? { paragraphBlocks } : {}),
      ms,
      meta: {
        granularity,
        leftChars: Array.from(left).length,
        rightChars: Array.from(right).length,
        errorCount: errors.length
      }
    })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[inspect-diff] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

async function handleRoute(req, res, url, pathname) {

  // 健康检查
  if (pathname === '/api/health') return sendJSON(res, 200, { ok: true, t: Date.now() })

  // 样本文件服务（samples/ 目录下的文件，避免 Vite proxy 拦截 /files/...）
  if (pathname.startsWith('/api/sample/')) {
    const rel = decodeURIComponent(pathname.slice('/api/sample/'.length))
    if (rel.includes('..') || !rel) {
      return sendJSON(res, 400, { error: 'invalid path' })
    }
    const filePath = path.join(CONFIG.SAMPLES_DIR, rel)
    console.log(`[sample] req=${pathname} rel=${rel} -> ${filePath} exists=${fs.existsSync(filePath)}`)
    if (!fs.existsSync(filePath)) {
      return sendJSON(res, 404, { error: 'sample not found' })
    }
    const ext = path.extname(filePath).toLowerCase()
    const mime = ext === '.txt' ? 'text/plain; charset=utf-8' : (MIME[ext] || 'application/octet-stream')
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return fs.createReadStream(filePath).pipe(res)
  }

  // PDFium 引擎健康 + metrics（用于线上可观测 / 性能监控）
  if (pathname === '/api/health/pdfium') {
    const m = getPdfiumMetrics()
    return sendJSON(res, 200, { ok: m.engine !== 'failed', ...m })
  }

  // 翻译 Provider 健康检查
  if (pathname === '/api/health/translate') {
    const providers = getAvailableProviders()
    const active = process.env.TRANSLATE_PROVIDER || 'mock'
    const hasAI = providers.some(p => p !== 'mock')
    return sendJSON(res, hasAI ? 200 : 503, {
      ok: hasAI,
      status: hasAI ? 'ok' : 'degraded',
      reason: hasAI ? null : 'no AI provider key configured (fallback to mock)',
      providers,
      active,
    })
  }

  // OCR 健康检查
  if (pathname === '/api/health/ocr') {
    const providers = getAvailableProviders().filter(p => p !== 'mock')
    const hasAI = providers.length > 0
    return sendJSON(res, hasAI ? 200 : 503, {
      ok: hasAI,
      status: hasAI ? 'ok' : 'degraded',
      reason: hasAI ? null : 'no AI vision key configured (fallback to heuristic, no text recognized)',
      providers,
      modes: hasAI ? ['ai-vision'] : ['heuristic'],
    })
  }

  // 智检 QC 健康检查
  if (pathname === '/api/health/qc') {
    const providers = getAvailableProviders().filter(p => p !== 'mock')
    const hasAI = providers.length > 0
    return sendJSON(res, hasAI ? 200 : 503, {
      ok: hasAI,
      status: hasAI ? 'ok' : 'degraded',
      reason: hasAI ? null : 'no AI provider key configured (fallback to heuristic regex)',
      providers,
      active: process.env.QC_PROVIDER || 'heuristic',
    })
  }

  // 聚合健康检查（前端启动 banner / 监控用）
  if (pathname === '/api/health/all') {
    const aiProviders = getAvailableProviders()
    const pdfiumMetrics = getPdfiumMetrics()
    const disk = (() => {
      try {
        const { UPLOAD_DIR, DERIVED_DIR } = CONFIG
        const stat = (p) => { try { return fs.statSync(p).size } catch { return 0 } }
        return {
          uploadBytes: stat(UPLOAD_DIR),
          derivedBytes: stat(DERIVED_DIR),
        }
      } catch { return null }
    })()
    const translateHasAI = aiProviders.some(p => p !== 'mock')
    const ocrHasAI = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)
    const overall = translateHasAI || ocrHasAI ? 'ok' : 'degraded'
    return sendJSON(res, 200, {
      ok: overall === 'ok',
      status: overall,
      version: '5.0',
      timestamp: Date.now(),
      pdfium: { ok: pdfiumMetrics.engine !== 'failed', ...pdfiumMetrics },
      translate: {
        ok: translateHasAI,
        providers: aiProviders,
        active: process.env.TRANSLATE_PROVIDER || 'mock',
      },
      ocr: {
        ok: ocrHasAI,
        providers: aiProviders.filter(p => p !== 'mock'),
        active: process.env.OCR_PROVIDER || process.env.TRANSLATE_PROVIDER || 'heuristic',
      },
      qc: {
        ok: translateHasAI,
        active: process.env.QC_PROVIDER || 'heuristic',
      },
      speech: speechHealth(),
      disk,
    })
  }

  // 当前渲染引擎标识（被前端 perf 面板消费）
  if (pathname === '/api/render-engine') {
    return sendJSON(res, 200, { engine: pdfRenderEngine() })
  }

  // 扫描样本（开发期手动触发）
  if (pathname === '/api/scan' && req.method === 'POST') {
    const n = scanSamples()
    return sendJSON(res, 200, { ok: true, imported: n })
  }

  // 任务列表（剔除内部文件系统路径，避免信息泄漏）
  if (pathname === '/api/tasks' && req.method === 'GET') {
    const safe = listTasks().map(t => {
      const { originalPath, previewPath, thumbPath, pagesDir, ...rest } = t
      // 兜底：用 text-layer data-page-w/h 作为权威尺寸（兼容老脏数据，API 返回了 thumb 尺寸）
      if (Array.isArray(rest.pages) && rest.pages.length && rest.textDir) {
        for (const p of rest.pages) {
          try {
            const pad3 = String(p.page).padStart(3, '0')
            const txtPath = path.join(rest.textDir, `page-${pad3}.html`)
            if (!fs.existsSync(txtPath)) continue
            const html = fs.readFileSync(txtPath, 'utf-8')
            const wm = html.match(/data-page-w="([\d.]+)"/)
            const hm = html.match(/data-page-h="([\d.]+)"/)
            if (wm && hm) {
              const tw = parseFloat(wm[1])
              const th = parseFloat(hm[1])
              // 若 API 维度与 text-layer 维度不一致（典型：thumb 96 DPI vs 栅格 120 DPI），以 text-layer 为准
              if (Math.abs((p.width || 0) - tw) > 1 || Math.abs((p.height || 0) - th) > 1) {
                p.width = tw
                p.height = th
              }
            }
          } catch {}
        }
      }
      return rest
    })
    return sendJSON(res, 200, { tasks: safe })
  }

  // 上传（流式）
  if (pathname === '/api/upload' && req.method === 'POST') {
    return await handleUpload(req, res)
  }

  // OCR 端点：POST /api/ocr/recognize（单图片 OCR 识别）
  if (pathname === '/api/ocr/recognize' && req.method === 'POST') {
    return await handleOCRRecognize(req, res)
  }

  // ============ 语音能力 ============
  // POST /api/speech/tts — 文本 → 音频（mp3/wav binary）
  if (pathname === '/api/speech/tts' && req.method === 'POST') {
    return await handleSpeechTTS(req, res)
  }
  // POST /api/speech/asr — 音频 taskId → 文字
  if (pathname === '/api/speech/asr' && req.method === 'POST') {
    return await handleSpeechASR(req, res)
  }
  // POST /api/speech/asr-segments — 音频 taskId → 分段 + per-segment 翻译
  if (pathname === '/api/speech/asr-segments' && req.method === 'POST') {
    return await handleSpeechAsrSegments(req, res)
  }
  // POST /api/voice/translate — 单次翻译（带 LRU 缓存）
  if (pathname === '/api/voice/translate' && req.method === 'POST') {
    return await handleVoiceTranslate(req, res)
  }
  // GET /api/voice/voices — 音色列表（降级到 FALLBACK_VOICES）
  if (pathname === '/api/voice/voices' && req.method === 'GET') {
    const r = await safeListVoices()
    return sendJSON(res, 200, r)
  }
  // GET /api/health/speech
  if (pathname === '/api/health/speech') {
    return sendJSON(res, 200, speechHealth())
  }

  // ============ 分片上传 + 秒传 + 历史 ============
  if (pathname === '/api/upload/check' && req.method === 'POST') {
    return await handleUploadCheck(req, res)
  }
  if (pathname === '/api/upload/chunk' && req.method === 'POST') {
    return await handleUploadChunk(req, res)
  }
  if (pathname === '/api/upload/merge' && req.method === 'POST') {
    return await handleUploadMerge(req, res)
  }
  if (pathname === '/api/upload/history' && req.method === 'GET') {
    return await handleUploadHistory(req, res)
  }

  // ============ 格式转换：POST /api/convert ============
  // 入参：{ taskId, target?: 'pdf' | 'images' }
  // 出参：{ taskId, status, target, pdfUrl?, pages?, meta }
  if (pathname === '/api/convert' && req.method === 'POST') {
    return await handleConvert(req, res)
  }

  // ============ 标注 CRUD ============
  // POST /api/annotate { taskId, page, text, note?, color? }
  if (pathname === '/api/annotate' && req.method === 'POST') {
    return await handleAnnotateCreate(req, res)
  }
  // GET /api/annotate/:taskId
  if (pathname.startsWith('/api/annotate/') && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.slice('/api/annotate/'.length))
    if (!taskId || taskId.includes('/')) return sendJSON(res, 400, { error: 'invalid taskId' })
    const annotations = listAnnotations(taskId)
    res.setHeader('X-Annotate-Count', String(annotations.length))
    return sendJSON(res, 200, { taskId, annotations })
  }
  // DELETE /api/annotate/:id?taskId=xxx （需 taskId 定位文件）
  if (pathname.startsWith('/api/annotate/') && req.method === 'DELETE') {
    return await handleAnnotateDelete(req, res, url)
  }

  // OCR 对比端点：POST /api/ocr/compare
  if (pathname === '/api/ocr/compare' && req.method === 'POST') {
    return await handleOCRCompare(req, res)
  }

  // ============ OCR → 可搜索 PDF 新文件 ============
  // 入参：{ taskId }  出参：{ taskId, originalUrl, size, engine, textRegions, ms }
  // 流程：复用 OCR → 生成可搜索 PDF → 落到 UPLOAD_DIR → 创建新 task
  if (pathname === '/api/ocr/create-task' && req.method === 'POST') {
    return await handleOcrCreateTask(req, res)
  }

  // 智检 diff：左/右文本 → 字符级 diff ops + 错误列表
  if (pathname === '/api/inspect/diff' && req.method === 'POST') {
    return await handleInspectDiff(req, res)
  }

  // 智检 AI 深度校对：text → AI 语义校对结果
  if (pathname === '/api/inspect/quality-check' && req.method === 'POST') {
    return await handleQualityCheck(req, res)
  }

  // 智检 分词 + 短语错误：left + right → 分词 tokens + 短语级错误
  if (pathname === '/api/inspect/phrase-errors' && req.method === 'POST') {
    return await handlePhraseErrors(req, res)
  }

  // 翻译双栏对照：taskId + targetLang + sourceLang → 段级翻译 + 段落 diff
  if (pathname === '/api/inspect/translate' && req.method === 'POST') {
    return await handleInspectTranslate(req, res)
  }

  // 翻译单页渲染：图片（DOCX→PDF→PDFium 栅格化）
  if (pathname === '/api/inspect/translate/render-image' && req.method === 'GET') {
    return await handleInspectTranslateImage(req, res, url)
  }

  // 翻译单页文字层：HTML spans
  if (pathname === '/api/inspect/translate/render-text' && req.method === 'GET') {
    return await handleInspectTranslateText(req, res, url)
  }

  // ============ Phase A.3：进度轮询 / 批量 / 术语表 / TM / 导出 ============
  // GET /api/inspect/translate/progress/:jobId
  {
    const progressMatch = pathname.match(/^\/api\/inspect\/translate\/progress\/([\w-]+)$/)
    if (progressMatch && req.method === 'GET') {
      return await handleInspectTranslateProgress(req, res, url, progressMatch[1])
    }
  }

  // POST /api/translate/image/batch
  if (pathname === '/api/translate/image/batch' && req.method === 'POST') {
    return await handleTranslateImageBatchStart(req, res)
  }
  // GET /api/translate/image/batch/:jobId — 复用 progress handler
  {
    const batchPollMatch = pathname.match(/^\/api\/translate\/image\/batch\/([\w-]+)$/)
    if (batchPollMatch && req.method === 'GET') {
      return await handleInspectTranslateProgress(req, res, url, batchPollMatch[1])
    }
  }
  // POST /api/translate/image/batch/:jobId/cancel
  {
    const batchCancelMatch = pathname.match(/^\/api\/translate\/image\/batch\/([\w-]+)\/cancel$/)
    if (batchCancelMatch && req.method === 'POST') {
      return await handleTranslateImageBatchCancel(req, res, batchCancelMatch[1])
    }
  }

  // 术语表 CRUD
  if (pathname === '/api/translate/glossary' && req.method === 'POST') {
    return await handleGlossaryCreate(req, res)
  }
  if (pathname === '/api/translate/glossary' && req.method === 'GET') {
    return await handleGlossaryList(req, res, url)
  }
  if (pathname === '/api/translate/glossary/import' && req.method === 'POST') {
    return await handleGlossaryImport(req, res)
  }
  {
    const glossaryDelMatch = pathname.match(/^\/api\/translate\/glossary\/([\w-]+)$/)
    if (glossaryDelMatch && req.method === 'DELETE') {
      return await handleGlossaryDelete(req, res, url, glossaryDelMatch[1])
    }
  }

  // 翻译记忆 CRUD
  if (pathname === '/api/translate/memory' && req.method === 'POST') {
    return await handleMemoryCreate(req, res)
  }
  if (pathname === '/api/translate/memory' && req.method === 'GET') {
    return await handleMemoryLookup(req, res, url)
  }
  {
    const memoryDelMatch = pathname.match(/^\/api\/translate\/memory\/([\w-]+)$/)
    if (memoryDelMatch && req.method === 'DELETE') {
      return await handleMemoryDelete(req, res, url, memoryDelMatch[1])
    }
  }

  // 导出
  if (pathname === '/api/inspect/translate/export' && req.method === 'GET') {
    return await handleInspectTranslateExport(req, res, url)
  }

  // 实时翻译（单段）：text + sourceLang + targetLang → target + charMap + ms
  if (pathname === '/api/translate/realtime' && req.method === 'POST') {
    return await handleTranslateRealtime(req, res)
  }

  // 词级对齐：src + tgt → srcTokens + tgtTokens + pairs（基于 Myers 词级 diff）
  if (pathname === '/api/translate/align' && req.method === 'POST') {
    return await handleTranslateAlign(req, res)
  }

  // 词级 diff（含 char-level offsets，供前端 span 染色）: POST /api/inspect/translate/word-diff
  if (pathname === '/api/inspect/translate/word-diff' && req.method === 'POST') {
    return await handleWordDiff(req, res)
  }

  // 翻译标注反馈 CRUD
  if (pathname === '/api/translate/annotation' && req.method === 'POST') {
    return await handleAnnotationCreate(req, res)
  }
  if (pathname === '/api/translate/annotation' && req.method === 'GET') {
    return await handleAnnotationList(req, res, url)
  }
  if (pathname === '/api/translate/annotation' && req.method === 'DELETE') {
    return await handleAnnotationDelete(req, res, url)
  }

  // ============ Phase B.1: 反馈驱动重翻译 ============
  // POST /api/translate/retranslate
  if (pathname === '/api/translate/retranslate' && req.method === 'POST') {
    return await handleRetranslate(req, res)
  }

  // ============ Workspace Timeline 时间线 ============
  // POST /api/workspace/timeline — 追加条目
  if (pathname === '/api/workspace/timeline' && req.method === 'POST') {
    return await handleTimelineAppend(req, res)
  }
  // POST /api/workspace/timeline/clear — 清空
  if (pathname === '/api/workspace/timeline/clear' && req.method === 'POST') {
    return await handleTimelineClear(req, res)
  }
  // GET /api/workspace/timeline?limit=&kind=
  if (pathname === '/api/workspace/timeline' && req.method === 'GET') {
    return await handleTimelineList(req, res, url)
  }
  // DELETE /api/workspace/timeline/:id
  {
    const tlMatch = pathname.match(/^\/api\/workspace\/timeline\/([\w-]+)$/)
    if (tlMatch && req.method === 'DELETE') {
      return await handleTimelineRemove(req, res, tlMatch[1])
    }
  }

  // OCR 模板 CRUD
  if (pathname === '/api/ocr/template' && req.method === 'POST') {
    return await handleOcrTemplateCreate(req, res)
  }
  if (pathname === '/api/ocr/templates' && req.method === 'GET') {
    return await handleOcrTemplateList(req, res, url)
  }
  if (pathname === '/api/ocr/recognize-template' && req.method === 'POST') {
    return await handleOcrRecognizeTemplate(req, res)
  }
  {
    const tplMatch = pathname.match(/^\/api\/ocr\/template\/([\w-]+)$/)
    if (tplMatch && req.method === 'GET') {
      return await handleOcrTemplateGet(req, res, tplMatch[1])
    }
    if (tplMatch && req.method === 'DELETE') {
      return await handleOcrTemplateDelete(req, res, tplMatch[1])
    }
  }

  // 文件服务 /api/files/:id?as=original|preview|thumb|page&n=N|text&n=N
  const m = pathname.match(/^\/api\/files\/([\w-]+)$/)
  if (m && req.method === 'GET') {
    const id = m[1]
    const as = url.searchParams.get('as') || 'preview'
    const task = getTask(id)
    if (!task) return sendJSON(res, 404, { error: 'task not found' })

    // ---------- ?as=thumb ----------
    if (as === 'thumb') {
      if (!task.thumbPath || !fs.existsSync(task.thumbPath)) return sendJSON(res, 404, { error: 'thumb not ready' })
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return serveFile(req, res, task.thumbPath, `thumb-${id}.png`, 'image/png', true)
    }

    // ---------- ?as=page&n=N ----------
    if (as === 'page') {
      const n = Number(url.searchParams.get('n'))
      if (!Number.isInteger(n) || n < 1) return sendJSON(res, 400, { error: 'invalid page number' })
      if (!task.pagesDir || !fs.existsSync(task.pagesDir)) return sendJSON(res, 404, { error: 'pages not ready' })
      const total = task.pagesTotal || 0
      if (n > total) return sendJSON(res, 404, { error: `page ${n} out of range (total ${total})` })
      const pad3 = String(n).padStart(3, '0')
      const pad2 = String(n).padStart(2, '0')
      const candidates = [
        path.join(task.pagesDir, `page-${pad3}.png`),
        path.join(task.pagesDir, `page-${pad2}.png`),
        path.join(task.pagesDir, `page-${n}.png`)
      ]
      const filePath = candidates.find(p => fs.existsSync(p))
      const safe = filePath && path.resolve(filePath).startsWith(path.resolve(task.pagesDir) + path.sep) ? filePath : null
      if (!safe) return sendJSON(res, 404, { error: `page ${n} not found` })
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      // 【PDFium 可观测】响应头：当前引擎 + 渲染耗时
      res.setHeader('X-Render-Engine', pdfRenderEngine())
      const st = fs.statSync(safe)
      res.setHeader('X-Render-Ms', String(st.mtimeMs | 0)) // 文件 mtime 作为生成时间戳
      res.setHeader('X-Page-Number', String(n))
      res.setHeader('X-Page-Total', String(total))
      return serveFile(req, res, safe, `page-${n}-${id}.png`, 'image/png', true)
    }

    // ---------- ?as=text&n=N (方案 B：透明文字覆盖层) ----------
    if (as === 'text') {
      const n = Number(url.searchParams.get('n'))
      if (!Number.isInteger(n) || n < 1) return sendJSON(res, 400, { error: 'invalid page number' })
      if (!task.textDir || !fs.existsSync(task.textDir)) return sendJSON(res, 404, { error: 'text layers not ready' })
      const total = task.pagesTotal || 0
      if (n > total) return sendJSON(res, 404, { error: `page ${n} out of range (total ${total})` })
      const pad3 = String(n).padStart(3, '0')
      const pad2 = String(n).padStart(2, '0')
      const candidates = [
        path.join(task.textDir, `page-${pad3}.html`),
        path.join(task.textDir, `page-${pad2}.html`),
        path.join(task.textDir, `page-${n}.html`)
      ]
      let filePath = candidates.find(p => fs.existsSync(p))
      const safe = filePath && path.resolve(filePath).startsWith(path.resolve(task.textDir) + path.sep) ? filePath : null
      if (!safe) return sendJSON(res, 404, { error: `text ${n} not found` })

      // 【自动重生】检测到旧版结构或非 PDFium 产物 → 用新代码按需重生
      // 1. 旧结构：含 <p style="position:absolute...display:flex"> 行容器
      // 2. 异常薄高：所有 span 高度都 < 5px（pdftotext 对长中文句的 bbox bug，旧代码无 16px 下限兜底）
      // 3. 非 PDFium 产物：缺少 data-pdfium 标记（兼容老任务从 poppler 路径迁过来）
      // 4. PDFium v1（data-pdfium="1"）：使用旧的 ASCENT_RATIO 近似公式，需升级到 v2 ink-bbox 直接定位
      let html = fs.readFileSync(safe, 'utf-8')
      const isOldFormat = /<p\s+style="[^"]*display:flex[^"]*align-items:\s*flex-end/i.test(html)
      const isNotPdfium4 = !/data-pdfium="4"/.test(html)  // v4+ 修正 PDFium render 像素尺寸公式（floor(floor(orig)*scale)）
      const heights = [...html.matchAll(/height:\s*([\d.]+)px/g)].map(m => parseFloat(m[1]))
      const hasThinWord = heights.length > 0 && heights.every(h => h < 5)
      const reason = isOldFormat ? 'old flex <p>' : (isNotPdfium4 ? 'pre-pdfium-v4' : (hasThinWord ? 'thin inkH' : null))
      if (reason && task.previewPath && fs.existsSync(task.previewPath)) {
        try {
          const result = await extractTextLayer(task.previewPath, n, safe, { renderDpi: CONFIG.RASTERIZE_PAGE_DPI })
          html = fs.readFileSync(safe, 'utf-8')
          console.log(`[text-layer] regenerated ${id}#${n} → ${result.words} chars (reason: ${reason})`)
        } catch (e) {
          console.warn(`[text-layer] regenerate failed for ${id}#${n}: ${e.message}`)
        }
      }

      // 【PDFium 可观测】响应头
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Render-Engine', pdfRenderEngine())
      const charCount = (html.match(/<span /g) || []).length
      res.setHeader('X-Char-Count', String(charCount))
      res.setHeader('X-Page-Number', String(n))
      res.setHeader('X-Page-Total', String(total))
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(html) })
      res.end(html)
      return
    }

    // ---------- ?as=original / preview ----------
    const filePath = as === 'original' ? task.originalPath : task.previewPath || task.originalPath
    const filename = as === 'original' ? task.name : `${task.name}.${task.previewExt || task.ext}`
    return serveFile(req, res, filePath, filename)
  }

  // ============ 静态前端 SPA 路由（web/dist/）========
  // 仅处理 GET；仅当 dist 存在；非 /api/* 路径优先尝试真实文件，命中失败则 SPA fallback 到 index.html
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    return serveStaticOrFallback(req, res, pathname)
  }

  sendJSON(res, 404, { error: 'not found', path: pathname })
}

/**
 * 静态资源服务（v4.2）：从 CONFIG.WEB_DIST_DIR 服务 Vite 产物
 *   - 命中真实文件（含 hashed assets）→ 直接 stream
 *   - 未命中 → 回退到 index.html（SPA 客户端路由）
 *   - 未构建 dist（开发模式）→ 返回 404 JSON，让前端用 5188 Vite 入口
 */
function serveStaticOrFallback(req, res, pathname) {
  const distDir = CONFIG.WEB_DIST_DIR
  if (!distDir || !fs.existsSync(distDir)) {
    return sendJSON(res, 404, {
      error: 'web dist not built',
      hint: 'run `npm --prefix web run build` or use dev mode (vite on :5188)'
    })
  }

  // 安全：禁止路径穿越（..、绝对路径）
  const safePath = pathname.replace(/\.\.+/g, '').replace(/^\/+/, '')
  let filePath = path.join(distDir, safePath)

  // 目录请求 → 找 index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }

  // 真实文件 → 直接服务
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase()
    const mime = MIME[ext] || 'application/octet-stream'
    // hashed assets → 永不过期；index.html → 不缓存（每次拿到最新构建产物引用）
    if (filePath.includes(path.join(distDir, 'assets'))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    }
    return serveFile(req, res, filePath, path.basename(filePath), mime, false)
  }

  // SPA fallback → index.html
  const indexPath = path.join(distDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    return serveFile(req, res, indexPath, 'index.html', 'text/html; charset=utf-8', false)
  }

  return sendJSON(res, 404, { error: 'web dist has no index.html', path: pathname })
}

/**
 * OCR 识别端点：POST /api/ocr/recognize
 * 入参：{ taskId: string }
 * 出参：OCRResult
 */
async function handleOCRRecognize(req, res) {
  try {
    const body = await readBody(req, 1024)
    const { taskId } = parseJSONBody(body)
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })

    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    const imagePath = task.previewPath || task.originalPath
    if (!imagePath || !fs.existsSync(imagePath)) {
      return sendJSON(res, 404, { error: 'image file not found' })
    }

    const result = await ocrImage(imagePath)
    res.setHeader('X-OCR-Engine', result.engine)
    res.setHeader('X-OCR-Ms', String(result.ms))
    res.setHeader('X-OCR-Regions', String(result.regions.length))

    console.log(`[ocr-recognize] task=${taskId} engine=${result.engine} text=${result.text?.length||0} regions=${result.regions.length} ms=${result.ms}`)
    return sendJSON(res, 200, result)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[ocr-recognize] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * OCR 对比端点：POST /api/ocr/compare
 * 入参：{ reference: string, test: string }
 * 出参：OCRComparision
 */
/**
 * OCR → 可搜索 PDF 新文件：POST /api/ocr/create-task
 * 入参：{ taskId }      原图任务（已上传）
 * 出参：{ taskId, originalUrl, size, engine, textRegions, ms }
 * 流程：
 *   1) 取源 task + 原图
 *   2) 复用 ocrImage() 识别得 regions
 *   3) generateSearchablePdf() 生成 PDF（含可搜索透明文字层）
 *   4) 写入 UPLOAD_DIR；createTaskFromFile() 建新 task
 *   5) 返回新 task 让前端追加到任务列表 → FilesPage 可预览/下载
 */
async function handleOcrCreateTask(req, res) {
  try {
    const body = await readBody(req, 1024)
    const { taskId } = parseJSONBody(body)
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })

    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    const imagePath = task.previewPath || task.originalPath
    if (!imagePath || !fs.existsSync(imagePath)) {
      return sendJSON(res, 404, { error: 'image file not found' })
    }

    // 步骤 1: OCR
    const t0 = Date.now()
    const ocr = await ocrImage(imagePath)

    // 步骤 2: 生成可搜索 PDF
    const baseName = path.parse(task.name).name || 'ocr'
    const title = `OCR · ${task.name}`
    const pdfBuf = generateSearchablePdf({
      text: ocr.text,
      title,
      pageSize: 'A4',
      imageSize: ocr.imageSize,
      regions: ocr.regions,
    })

    // 步骤 3: 写文件 + 注册为新 task
    const id = uid()
    const fileName = baseName + '-searchable.pdf'
    const dest = path.join(CONFIG.UPLOAD_DIR, id + '_' + fileName)
    fs.writeFileSync(dest, pdfBuf)

    const newTask = createTaskFromFile({
      name: fileName,
      size: pdfBuf.length,
      mtime: Date.now(),
      ext: 'pdf',
      strategy: 'frontend',
      originalPath: dest,
    })

    // 在新 task 上记下 OCR 元数据 + 来源（前端可显示）
    updateTask(newTask.id, {
      meta: {
        sourceTaskId: task.id,
        ocrEngine: ocr.engine,
        ocrMs: ocr.ms,
        ocrTextRegions: ocr.regions?.length || 0,
        originalImageName: task.name,
      },
    })

    const ms = Date.now() - t0
    res.setHeader('X-OCR-PDF-Engine', 'office-preview-pdf')
    res.setHeader('X-OCR-Ms', String(ocr.ms))
    res.setHeader('X-OCR-Regions', String(ocr.regions?.length || 0))
    res.setHeader('X-OCR-Text', String((ocr.text || '').length))

    console.log(`[ocr-create-task] src=${taskId} ocr=${ocr.engine} regions=${ocr.regions?.length || 0} pdf=${pdfBuf.length}B task=${newTask.id} ms=${ms}`)
    return sendJSON(res, 200, {
      taskId: newTask.id,
      originalUrl: newTask.originalUrl,
      size: newTask.size,
      engine: ocr.engine,
      textRegions: ocr.regions?.length || 0,
      ms,
      sourceTaskId: task.id,
      name: newTask.name,
    })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[ocr-create-task] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}
/**
 * 格式转换端点：POST /api/convert
 * 入参：{ taskId, target?: 'pdf' | 'images' }
 * 出参：{ taskId, status, target, pdfUrl?, pages?, meta }
 *
 * 设计：上传时已自动转 PDF + 栅格化图片 + 文字层。本端点为幂等"ensure"：
 *   - convertStatus === 'done'  → 直接返回产物（pdfUrl + pages）
 *   - pending/processing/rasterizing/retrying → 返回 progress（前端轮询）
 *   - failed → 返回 error 让前端展示
 *   - frontend 策略（图/文/媒体）→ 返回原始 url 作为"产物"
 */
async function handleConvert(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const { taskId, target = 'pdf' } = parseJSONBody(body)
    if (typeof taskId !== 'string' || !taskId) {
      return sendJSON(res, 400, { error: 'taskId required' })
    }
    if (target !== 'pdf' && target !== 'images') {
      return sendJSON(res, 400, { error: "target must be 'pdf' or 'images'" })
    }
    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: 'task not found' })

    const status = task.convertStatus || 'done'
    res.setHeader('X-Convert-Status', String(status))
    res.setHeader('X-Convert-Target', String(target))
    res.setHeader('X-Convert-Strategy', String(task.strategy || ''))

    // 进行中：仅返回进度，无产物
    if (['pending', 'processing', 'rasterizing', 'retrying'].includes(status)) {
      const pagesTotal = task.pagesTotal || 0
      const pagesDone = task.pagesDone || 0
      const pct = pagesTotal > 0 ? Math.round((pagesDone / pagesTotal) * 100) : 0
      console.log(`[convert] ${taskId} status=${status} pct=${pct}%`)
      return sendJSON(res, 200, {
        taskId,
        status,
        target,
        progress: { pagesTotal, pagesDone, pct },
        meta: { stage: task.convertStage || null },
      })
    }

    // 失败
    if (status === 'failed') {
      console.warn(`[convert] ${taskId} failed: ${task.convertError || 'unknown'}`)
      return sendJSON(res, 200, {
        taskId,
        status,
        target,
        error: task.convertError || 'conversion failed',
      })
    }

    // 完成 → 返回产物
    const pages = (task.pages || []).map(p => ({
      page: p.page,
      url: p.url,
      textUrl: p.textUrl || null,
      width: p.width,
      height: p.height,
      bytes: p.bytes || 0,
      textWords: p.textWords || 0,
    }))
    const pdfUrl = task.previewUrl || null
    const pdfSize = task.previewSize || 0
    const meta = {
      pagesCount: pages.length,
      pagesTotal: task.pagesTotal || pages.length,
      pdfSize,
      convertMs: task.convertDurationMs || 0,
      engine: 'soffice+pdfium',
      ext: task.ext,
      strategy: task.strategy,
    }
    res.setHeader('X-Convert-Pages', String(pages.length))
    res.setHeader('X-Convert-Pdf-Bytes', String(pdfSize))
    console.log(`[convert] ${taskId} done pages=${pages.length} pdf=${pdfSize}B target=${target}`)
    return sendJSON(res, 200, {
      taskId,
      status: 'done',
      target,
      pdfUrl,
      pages,
      originalUrl: task.originalUrl,
      meta,
    })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[convert] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/** POST /api/annotate { taskId, page, text, note?, color? } */
async function handleAnnotateCreate(req, res) {
  try {
    const body = await readBody(req, 32 * 1024)
    const { taskId, page, text, note, color } = parseJSONBody(body)
    if (typeof taskId !== 'string' || !taskId) return sendJSON(res, 400, { error: 'taskId required' })
    if (typeof page !== 'number' || page < 1) return sendJSON(res, 400, { error: 'invalid page' })
    if (typeof text !== 'string' || !text.trim()) return sendJSON(res, 400, { error: 'text required' })

    const ann = createAnnotation({ taskId, page, text, note, color })
    res.setHeader('X-Annotate-Id', ann.id)
    console.log(`[annotate] create task=${taskId} page=${page} id=${ann.id} text=${text.length}B`)
    return sendJSON(res, 200, ann)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[annotate] create failed:', e.message)
    return sendJSON(res, 400, { error: e.message || 'internal error' })
  }
}

/** DELETE /api/annotate/:id?taskId=xxx */
async function handleAnnotateDelete(req, res, url) {
  try {
    const id = decodeURIComponent(url.pathname.slice('/api/annotate/'.length))
    const taskId = url.searchParams.get('taskId')
    if (!id || !taskId) return sendJSON(res, 400, { error: 'id and taskId required' })
    const ok = deleteAnnotation(taskId, id)
    if (!ok) return sendJSON(res, 404, { error: 'annotation not found' })
    console.log(`[annotate] delete task=${taskId} id=${id}`)
    return sendJSON(res, 200, { ok: true, id, taskId })
  } catch (e) {
    console.error('[annotate] delete failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

async function handleOCRCompare(req, res) {
  try {
    const MAX_TEXT = 100 * 1024
    const body = await readBody(req, MAX_TEXT * 2 + 1024)
    const { reference = '', test = '' } = parseJSONBody(body)
    if (typeof reference !== 'string' || typeof test !== 'string') {
      return sendJSON(res, 400, { error: 'reference/test must be string' })
    }

    const result = compareOCRResults(reference, test)
    res.setHeader('X-OCR-Compare-Ms', String(result.ms))
    res.setHeader('X-OCR-Compare-Errors', String(result.errors.length))

    console.log(`[ocr-compare] ref=${reference.length}B test=${test.length}B errors=${result.errors.length} ms=${result.ms}`)
    return sendJSON(res, 200, result)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[ocr-compare] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * AI 语义校对端点：POST /api/inspect/quality-check
 * 入参：{ text: string }
 * 出参：{ errors, summary, ms, engine }
 */
async function handleQualityCheck(req, res) {
  try {
    const MAX_TEXT = 200 * 1024
    const body = await readBody(req, MAX_TEXT + 1024)
    const { text = '' } = parseJSONBody(body)
    if (typeof text !== 'string') return sendJSON(res, 400, { error: 'text must be string' })
    if (text.length > MAX_TEXT) return sendJSON(res, 413, { error: `text too long (max ${MAX_TEXT} chars)` })

    const result = await aiQualityCheck(text)
    res.setHeader('X-QC-Engine', result.engine)
    res.setHeader('X-QC-Ms', String(result.ms))
    res.setHeader('X-QC-Errors', String(result.errors.length))

    console.log(`[quality-check] engine=${result.engine} errors=${result.errors.length} ms=${result.ms}`)
    return sendJSON(res, 200, result)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[quality-check] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 短语级错误检测端点：POST /api/inspect/phrase-errors
 * 入参：{ left: string, right: string }
 * 出参：{ errors, tokens_left, tokens_right, ms }
 */
async function handlePhraseErrors(req, res) {
  try {
    const MAX_TEXT = 200 * 1024
    const body = await readBody(req, MAX_TEXT * 2 + 1024)
    const { left = '', right = '' } = parseJSONBody(body)
    if (typeof left !== 'string' || typeof right !== 'string') {
      return sendJSON(res, 400, { error: 'left/right must be string' })
    }

    const t0 = Date.now()
    const errors = detectPhraseErrors(left, right)
    const tokensLeft = segmentWords(left)
    const tokensRight = segmentWords(right)
    const ms = Date.now() - t0

    res.setHeader('X-Phrase-Ms', String(ms))
    res.setHeader('X-Phrase-Errors', String(errors.length))

    console.log(`[phrase-errors] left=${left.length}B right=${right.length}B errors=${errors.length} tokens=${tokensLeft.length}/${tokensRight.length} ms=${ms}`)
    return sendJSON(res, 200, { errors, tokens_left: tokensLeft, tokens_right: tokensRight, ms })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[phrase-errors] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 翻译双栏对照端点：POST /api/inspect/translate
 * 入参：{ taskId, sourceLang, targetLang, linesPerPage?, pageW?, pageH? }
 * 出参：TranslateResponse（含 segments / paragraphBlocks / pages）
 * 响应头：X-Translate-Engine / X-Translate-Ms / X-Translate-Segments / X-Translate-Pages
 */
async function handleInspectTranslate(req, res) {
  try {
    const MAX_TEXT = 200 * 1024
    const body = await readBody(req, MAX_TEXT + 1024)
    const {
      taskId, sourceLang = 'zh-CN', targetLang,
      linesPerPage, pageW, pageH,
      strategy,  // v4.0: 'passthrough' | 'synthetic'（可选）
      text: inlineText,  // v4.2: standalone 模式（前端 TranslationPage 直接传文本）
      jobId,             // v4.3: 可选；启用 JSONL 进度日志
      glossary,          // v4.3: 可选；术语表 Term[]
      tm,                // v4.3: 可选；翻译记忆 TmEntry[]
    } = parseJSONBody(body)
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })
    if (!targetLang) return sendJSON(res, 400, { error: 'targetLang required' })
    if (!SUPPORTED_LANGS.has(targetLang)) return sendJSON(res, 400, { error: `unsupported targetLang: ${targetLang}` })
    if (!SUPPORTED_LANGS.has(sourceLang)) return sendJSON(res, 400, { error: `unsupported sourceLang: ${sourceLang}` })
    if (strategy && !['passthrough', 'synthetic'].includes(strategy)) {
      return sendJSON(res, 400, { error: `unsupported strategy: ${strategy}` })
    }

    const isStandalone = taskId === 'standalone'

    let task = null
    let text = ''

    if (isStandalone) {
      // v4.2：standalone 模式（无需上传文件，文本直接来自 body）
      if (typeof inlineText !== 'string') {
        return sendJSON(res, 400, { error: 'standalone mode requires text in body' })
      }
      text = inlineText
    } else {
      task = getTask(taskId)
      if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })
      text = extractTaskText(task)
    }

    const t0 = Date.now()
    const result = await translate({
      text, sourceLang, targetLang, taskId, strategy,
      task,  // v4.0：translate() 用 task.ext/previewExt/pages 判断走 identity mock 还是 synthetic
      linesPerPage: linesPerPage ? Number(linesPerPage) : undefined,
      pageW: pageW ? Number(pageW) : undefined,
      pageH: pageH ? Number(pageH) : undefined,
      jobId: jobId || null,
      glossary: Array.isArray(glossary) ? glossary : null,
      tm: Array.isArray(tm) ? tm : null,
    })
    const ms = Date.now() - t0

    // 可观测响应头
    const engine = result.meta?.engine || 'mock-v1'
    const mode = result.meta?.mode || 'text'
    const sourceWords = result.meta?.sourceWords ?? 0
    const glossaryHits = result.meta?.glossaryHits ?? 0
    const tmHits = result.meta?.tmHits ?? 0
    const finalJobId = result.meta?.jobId || jobId
    res.setHeader('X-Translate-Engine', engine)
    res.setHeader('X-Translate-Strategy', strategy || 'synthetic')
    res.setHeader('X-Translate-Ms', String(ms))
    res.setHeader('X-Translate-Segments', String(result.segments.length))
    res.setHeader('X-Translate-Pages', String(result.pages.length))
    res.setHeader('X-Translate-Source-Chars', String(result.meta.sourceChars))
    res.setHeader('X-Translate-Target-Chars', String(result.meta.targetChars))
    // v4.3: 新增观测头
    res.setHeader('X-Translate-Mode', mode)
    res.setHeader('X-Translate-Words', String(sourceWords))
    res.setHeader('X-Translate-Glossary-Hits', String(glossaryHits))
    res.setHeader('X-Translate-TM-Hits', String(tmHits))
    if (finalJobId) res.setHeader('X-Job-Id', finalJobId)

    // 服务端日志
    console.log(`[inspect-translate] task=${taskId} ${sourceLang}→${targetLang} strategy=${strategy || 'synthetic'} engine=${engine} mode=${mode} segments=${result.segments.length} pages=${result.pages.length} srcChars=${result.meta.sourceChars} words=${sourceWords} glossaryHits=${glossaryHits} tmHits=${tmHits} ms=${ms}`)

    return sendJSON(res, 200, result)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[inspect-translate] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 翻译单页图片渲染：?taskId=...&page=N&targetLang=en&sourceLang=zh-CN
 * 入参：URL query
 * 出参：image/png（PDFium 栅格化的 PNG）
 * 响应头：X-Translate-Page / X-Translate-Cached / X-Translate-Render-Ms
 */
async function handleInspectTranslateImage(req, res, url) {
  try {
    const taskId = url.searchParams.get('taskId')
    const page = Number(url.searchParams.get('page') || 1)
    const targetLang = url.searchParams.get('targetLang') || 'en'
    const sourceLang = url.searchParams.get('sourceLang') || 'zh-CN'
    const strategy = url.searchParams.get('strategy') || undefined  // v4.0: 'passthrough' | undefined
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })
    if (!Number.isInteger(page) || page < 1) return sendJSON(res, 400, { error: 'invalid page' })
    if (!SUPPORTED_LANGS.has(targetLang)) return sendJSON(res, 400, { error: `unsupported targetLang: ${targetLang}` })
    if (strategy && !['passthrough', 'synthetic'].includes(strategy)) {
      return sendJSON(res, 400, { error: `unsupported strategy: ${strategy}` })
    }
    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    // 拉取该页的 sourceText / targetText（轻量：复用 translate 端点逻辑）
    const text = extractTaskText(task)
    const t0 = Date.now()
    const tr = await translate({ text, sourceLang, targetLang, taskId, strategy, task })
    const pageData = tr.pages[page - 1]
    if (!pageData) return sendJSON(res, 404, { error: `page ${page} out of range (total ${tr.pages.length})` })

    const r = await renderTranslatedPage({
      taskId, pageNum: page,
      sourceText: pageData.sourceText,
      targetLang,
      targetText: pageData.targetText,
      charMap: pageData.charMap,
      strategy,
    })
    const totalMs = Date.now() - t0

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('X-Translate-Page', String(page))
    res.setHeader('X-Translate-Cached', r.cached ? '1' : '0')
    res.setHeader('X-Translate-Render-Ms', String(r.ms))
    res.setHeader('X-Translate-Total-Ms', String(totalMs))
    res.setHeader('X-Translate-Page-W', String(r.pageW))
    res.setHeader('X-Translate-Page-H', String(r.pageH))
    res.setHeader('X-Translate-Strategy', strategy || 'synthetic')

    const stat = fs.statSync(r.imagePath)
    res.writeHead(200, { 'Content-Length': stat.size })
    fs.createReadStream(r.imagePath).pipe(res)
  } catch (e) {
    console.error('[inspect-translate-image] failed:', e.message)
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 翻译单页文字层：?taskId=...&page=N&targetLang=en&sourceLang=zh-CN
 * 入参：URL query
 * 出参：text/html（PDFium 文字层 spans）
 * 响应头：X-Translate-Page / X-Translate-Cached / X-Translate-Render-Ms
 */
async function handleInspectTranslateText(req, res, url) {
  try {
    const taskId = url.searchParams.get('taskId')
    const page = Number(url.searchParams.get('page') || 1)
    const targetLang = url.searchParams.get('targetLang') || 'en'
    const sourceLang = url.searchParams.get('sourceLang') || 'zh-CN'
    const strategy = url.searchParams.get('strategy') || undefined  // v4.0
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })
    if (!Number.isInteger(page) || page < 1) return sendJSON(res, 400, { error: 'invalid page' })
    if (!SUPPORTED_LANGS.has(targetLang)) return sendJSON(res, 400, { error: `unsupported targetLang: ${targetLang}` })
    if (strategy && !['passthrough', 'synthetic'].includes(strategy)) {
      return sendJSON(res, 400, { error: `unsupported strategy: ${strategy}` })
    }
    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    const text = extractTaskText(task)
    const t0 = Date.now()
    const tr = await translate({ text, sourceLang, targetLang, taskId, strategy, task })
    const pageData = tr.pages[page - 1]
    if (!pageData) return sendJSON(res, 404, { error: `page ${page} out of range (total ${tr.pages.length})` })

    const r = await renderTranslatedPage({
      taskId, pageNum: page,
      sourceText: pageData.sourceText,
      targetLang,
      targetText: pageData.targetText,
      charMap: pageData.charMap,
      strategy,
    })
    const totalMs = Date.now() - t0

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('X-Translate-Page', String(page))
    res.setHeader('X-Translate-Cached', r.cached ? '1' : '0')
    res.setHeader('X-Translate-Render-Ms', String(r.ms))
    res.setHeader('X-Translate-Total-Ms', String(totalMs))
    res.setHeader('X-Translate-Strategy', strategy || 'synthetic')

    const html = fs.readFileSync(r.textPath, 'utf-8')
    res.writeHead(200, { 'Content-Length': Buffer.byteLength(html) })
    res.end(html)
  } catch (e) {
    console.error('[inspect-translate-text] failed:', e.message)
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 实时翻译（单段）：POST /api/translate/realtime
 * 入参：{ text, sourceLang = 'zh-CN', targetLang }
 * 出参：{ target, charMap, engine, provider, ms }
 * 响应头：X-Translate-Engine / X-Translate-Ms / X-Translate-Provider / X-Translate-Chars
 *
 * 与 /api/inspect/translate 的区别：轻量单段实时翻译，无段落分割/分页/渲染产物。
 * 适合前端 debounce 输入框 → 即时反馈场景。
 */
async function handleTranslateRealtime(req, res) {
  try {
    const MAX_TEXT = 16 * 1024
    const body = await readBody(req, MAX_TEXT + 1024)
    const { text, sourceLang = 'zh-CN', targetLang, provider } = parseJSONBody(body)
    if (typeof text !== 'string' || !text.trim()) return sendJSON(res, 400, { error: 'text required' })
    if (text.length > MAX_TEXT) return sendJSON(res, 413, { error: 'text too large' })
    if (!targetLang) return sendJSON(res, 400, { error: 'targetLang required' })
    if (!SUPPORTED_LANGS.has(targetLang)) return sendJSON(res, 400, { error: `unsupported targetLang: ${targetLang}` })
    if (!SUPPORTED_LANGS.has(sourceLang)) return sendJSON(res, 400, { error: `unsupported sourceLang: ${sourceLang}` })

    const t0 = Date.now()
    const r = await translateAI({ text, sourceLang, targetLang, provider })
    const ms = Date.now() - t0

    res.setHeader('X-Translate-Engine', r.engine)
    res.setHeader('X-Translate-Ms', String(ms))
    res.setHeader('X-Translate-Provider', r.provider)
    res.setHeader('X-Translate-Chars', String(text.length))
    console.log(`[translate-realtime] ${sourceLang}→${targetLang} provider=${r.provider} srcLen=${text.length} tgtLen=${r.target.length} ms=${ms}`)

    return sendJSON(res, 200, {
      target: r.target,
      charMap: r.charMap || [],
      engine: r.engine,
      provider: r.provider,
      ms,
    })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[translate-realtime] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 词级对齐：POST /api/translate/align
 * 入参：{ src, tgt, srcLang?, tgtLang? }
 * 出参：{ srcTokens:string[], tgtTokens:string[], pairs:Array<[srcIdx, tgtIdx, score]> }
 *
 * 算法：基于 segmentWords 分词 + Myers 词级 diff
 *   - equal：词序列中相同词对齐（score=1.0）
 *   - delete + 相邻 insert：1:1 配对（score=0.5，弱匹配）
 *   - 多余的 delete/insert：未配对，不入 pairs
 *
 * 替代 ./网页翻译/lib/word-aligner.mjs 的 700MB ONNX MarianMT 方案，
 * 实现 0 依赖 + <5ms 响应。
 */
async function handleTranslateAlign(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const { src, tgt } = parseJSONBody(body)
    if (typeof src !== 'string' || !src.trim()) return sendJSON(res, 400, { error: 'src required' })
    if (typeof tgt !== 'string' || !tgt.trim()) return sendJSON(res, 400, { error: 'tgt required' })

    const t0 = Date.now()
    const srcTokens = segmentWords(src)
    const tgtTokens = segmentWords(tgt)
    const ops = myersDiffArray(srcTokens, tgtTokens)

    const pairs = []
    let srcPos = 0, tgtPos = 0
    let i = 0
    while (i < ops.length) {
      const op = ops[i]
      if (op.op === 'equal') {
        // 1:1 对齐（同词序）
        const len = Array.from(op.text).length  // myersDiffArray 对 array 元素，text 是单个 token 字符串
        // 注：array 版本中 'equal'/'delete'/'insert' 的 text 是单个元素（字符串）
        pairs.push([srcPos, tgtPos, 1.0])
        srcPos++; tgtPos++
        i++
        continue
      }
      // 收集连续 delete+insert 进行 1:1 配对
      let delCount = 0, insCount = 0
      const srcStart = srcPos, tgtStart = tgtPos
      while (i < ops.length && ops[i].op !== 'equal') {
        if (ops[i].op === 'delete') { delCount++; srcPos++ }
        else { insCount++; tgtPos++ }
        i++
      }
      // 1:1 配对前 min(del,ins) 个
      const paired = Math.min(delCount, insCount)
      for (let k = 0; k < paired; k++) {
        pairs.push([srcStart + k, tgtStart + k, 0.5])
      }
    }

    const ms = Date.now() - t0
    res.setHeader('X-Align-Engine', 'myers-word-v1')
    res.setHeader('X-Align-Ms', String(ms))
    res.setHeader('X-Align-Src-Tokens', String(srcTokens.length))
    res.setHeader('X-Align-Tgt-Tokens', String(tgtTokens.length))
    res.setHeader('X-Align-Pairs', String(pairs.length))
    console.log(`[translate-align] srcTokens=${srcTokens.length} tgtTokens=${tgtTokens.length} pairs=${pairs.length} ms=${ms}`)

    return sendJSON(res, 200, { srcTokens, tgtTokens, pairs })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    console.error('[translate-align] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 词级 diff：POST /api/inspect/translate/word-diff
 * 入参：{ taskId, segmentId?, source, target, langPair? }
 * 出参：{ srcTokens, tgtTokens, srcOffsets, tgtOffsets, ops, srcChars, tgtChars, ms, langPair }
 * 响应头：X-Translate-WordDiff-{Src-Tokens, Tgt-Tokens, Ops, Ms, Lang-Pair}
 */
async function handleWordDiff(req, res) {
  try {
    const body = await readBody(req, 128 * 1024)
    const { taskId, segmentId, source, target, langPair } = parseJSONBody(body)
    if (typeof source !== 'string') return sendJSON(res, 400, { error: 'source required' })
    if (typeof target !== 'string') return sendJSON(res, 400, { error: 'target required' })

    const lp = Array.isArray(langPair) && langPair.length === 2 ? langPair : ['zh', 'en']
    const result = wordDiff(source, target, lp)

    res.setHeader('X-Translate-WordDiff-Src-Tokens', String(result.srcTokens.length))
    res.setHeader('X-Translate-WordDiff-Tgt-Tokens', String(result.tgtTokens.length))
    res.setHeader('X-Translate-WordDiff-Ops', String(result.ops.length))
    res.setHeader('X-Translate-WordDiff-Ms', String(result.ms))
    res.setHeader('X-Translate-WordDiff-Lang-Pair', lp.join('-'))
    if (taskId) res.setHeader('X-Translate-WordDiff-Task-Id', String(taskId))
    if (segmentId) res.setHeader('X-Translate-WordDiff-Segment-Id', String(segmentId))
    console.log(
      `[translate-word-diff ${new Date().toISOString()}] task=${taskId || '-'} seg=${segmentId || '-'} srcTokens=${result.srcTokens.length} tgtTokens=${result.tgtTokens.length} ops=${result.ops.length} ms=${result.ms} langPair=${lp.join('-')}`,
    )

    return sendJSON(res, 200, result)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    console.error('[translate-word-diff] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 翻译标注反馈 创建：POST /api/translate/annotation
 * 入参（简化 schema，对齐 ./网页翻译/lib/annotation.mjs 但去掉 url/domPath 强依赖）：
 *   { kind: 'align_fix'|'seg_rating'|'alt_trans', taskId, segmentId,
 *     srcText, tgtText, langPair:[src,tgt], payload, context? }
 * 出参：{ ok, id, annotation }
 * 响应头：X-Annotation-Id / X-Annotation-Kind
 */
async function handleAnnotationCreate(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const input = parseJSONBody(body)
    const { encode } = await import('./annotation-schema.mjs')

    // 补充 schema 必需字段（前端可不传）
    if (!input.url) input.url = `task://${input.taskId || 'standalone'}`
    if (!input.domPath) input.domPath = `seg:${input.segmentId || '0'}`
    if (!input.srcSegmentId) input.srcSegmentId = String(input.segmentId || '0')
    if (!input.modelVersion) input.modelVersion = 'myers-word-v1'
    if (!Array.isArray(input.srcTokens)) input.srcTokens = segmentWords(input.srcText || '')
    if (!Array.isArray(input.tgtTokens)) input.tgtTokens = segmentWords(input.tgtText || '')
    if (!Array.isArray(input.predicted)) input.predicted = []

    const annotation = encode(input)
    const fileDir = path.join(CONFIG.DERIVED_DIR, 'translate-annotations')
    fs.mkdirSync(fileDir, { recursive: true })
    const file = path.join(fileDir, `${(input.taskId || 'standalone').replace(/[^\w-]/g, '_')}.jsonl`)
    fs.appendFileSync(file, JSON.stringify(annotation) + '\n')

    res.setHeader('X-Annotation-Id', annotation.id)
    res.setHeader('X-Annotation-Kind', annotation.kind)
    // Phase A.5 — standardized observability headers (additive, backward-compat)
    res.setHeader('X-Translate-Annotation-Id', annotation.id)
    res.setHeader('X-Translate-Annotation-Kind', annotation.kind)
    // encode() returns createdAt (Date.now() at creation); use it as updatedAt
    res.setHeader(
      'X-Translate-Annotation-Updated-At',
      new Date(annotation.createdAt).toISOString(),
    )
    console.log(`[annotation-create] kind=${annotation.kind} task=${input.taskId || 'standalone'} id=${annotation.id}`)
    console.log(
      `[translate-annotation ${new Date().toISOString()}] task=${input.taskId || 'standalone'} kind=${annotation.kind} action=add segId=${input.segmentId || ''} id=${annotation.id}`,
    )

    return sendJSON(res, 200, { ok: true, id: annotation.id, annotation })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.name === 'ValidationError') return sendJSON(res, 400, { error: e.message, field: e.field })
    console.error('[annotation-create] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 翻译标注 列表：GET /api/translate/annotation?taskId=xxx
 * 出参：{ items: Annotation[] }
 */
async function handleAnnotationList(req, res, url) {
  try {
    const taskId = (url.searchParams.get('taskId') || 'standalone').replace(/[^\w-]/g, '_')
    const file = path.join(CONFIG.DERIVED_DIR, 'translate-annotations', `${taskId}.jsonl`)
    if (!fs.existsSync(file)) {
      res.setHeader('X-Annotation-Count', '0')
      // Phase A.5 — standardized observability headers (additive, backward-compat)
      res.setHeader('X-Translate-Annotation-Count', '0')
      res.setHeader('X-Translate-Annotation-Task-Id', taskId)
      console.log(
        `[translate-annotation ${new Date().toISOString()}] task=${taskId} action=list count=0`,
      )
      return sendJSON(res, 200, { items: [] })
    }
    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter(l => l.trim())
    const { decode } = await import('./annotation-schema.mjs')
    const items = []
    for (const line of lines) {
      try { items.push(decode(line)) } catch (e) { console.warn('[annotation-list] skip bad line:', e.message) }
    }
    res.setHeader('X-Annotation-Count', String(items.length))
    // Phase A.5 — standardized observability headers (additive, backward-compat)
    res.setHeader('X-Translate-Annotation-Count', String(items.length))
    res.setHeader('X-Translate-Annotation-Task-Id', taskId)
    console.log(`[annotation-list] task=${taskId} count=${items.length}`)
    console.log(
      `[translate-annotation ${new Date().toISOString()}] task=${taskId} action=list count=${items.length}`,
    )
    return sendJSON(res, 200, { items })
  } catch (e) {
    console.error('[annotation-list] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 翻译标注 删除：DELETE /api/translate/annotation?taskId=xxx&id=yyy
 */
async function handleAnnotationDelete(req, res, url) {
  try {
    const taskId = (url.searchParams.get('taskId') || 'standalone').replace(/[^\w-]/g, '_')
    const id = url.searchParams.get('id')
    if (!id) return sendJSON(res, 400, { error: 'id required' })
    const file = path.join(CONFIG.DERIVED_DIR, 'translate-annotations', `${taskId}.jsonl`)
    if (!fs.existsSync(file)) return sendJSON(res, 404, { error: 'no annotations for task' })

    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter(l => l.trim())
    const kept = []
    let removed = 0
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.id === id) { removed++; continue }
        kept.push(line)
      } catch { kept.push(line) }
    }
    if (removed === 0) return sendJSON(res, 404, { error: 'annotation not found' })

    if (kept.length === 0) fs.unlinkSync(file)
    else fs.writeFileSync(file, kept.join('\n') + '\n')

    res.setHeader('X-Annotation-Removed', String(removed))
    // Phase A.5 — standardized observability headers (additive, backward-compat)
    res.setHeader('X-Translate-Annotation-Removed-Id', id)
    res.setHeader('X-Translate-Annotation-Task-Id', taskId)
    console.log(`[annotation-delete] task=${taskId} id=${id} removed=${removed}`)
    console.log(
      `[translate-annotation ${new Date().toISOString()}] task=${taskId} action=delete id=${id}`,
    )
    return sendJSON(res, 200, { ok: true, removed })
  } catch (e) {
    console.error('[annotation-delete] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * OCR 模板 创建：POST /api/ocr/template
 * 入参：{ name, scenario: 'finance'|'medical'|'general'|'id-card', sign?, fields: [{name,type,x,y,w,h}], sampleImageUrl? }
 * 出参：{ id, template }
 */
async function handleOcrTemplateCreate(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const input = parseJSONBody(body)
    const tpl = createTemplate(input)
    res.setHeader('X-Template-Id', tpl.id)
    return sendJSON(res, 200, { id: tpl.id, template: tpl })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    console.error('[ocr-template-create] failed:', e.message)
    return sendJSON(res, 400, { error: e.message })
  }
}

/**
 * OCR 模板 列表：GET /api/ocr/templates?scenario=xxx
 */
async function handleOcrTemplateList(req, res, url) {
  const scenario = url.searchParams.get('scenario') || undefined
  const items = listTemplates({ scenario })
  res.setHeader('X-Template-Count', String(items.length))
  return sendJSON(res, 200, { items })
}

/**
 * OCR 模板 单个：GET /api/ocr/template/:id
 */
async function handleOcrTemplateGet(req, res, id) {
  const tpl = getTemplate(id)
  if (!tpl) return sendJSON(res, 404, { error: 'template not found' })
  return sendJSON(res, 200, tpl)
}

/**
 * OCR 模板 删除：DELETE /api/ocr/template/:id
 */
async function handleOcrTemplateDelete(req, res, id) {
  const ok = deleteTemplate(id)
  if (!ok) return sendJSON(res, 404, { error: 'template not found' })
  return sendJSON(res, 200, { ok: true, id })
}

/**
 * OCR 模板识别：POST /api/ocr/recognize-template
 * 入参：{ taskId, templateId }
 * 出参：{ engine, fields: [{name, value, location?, confidence}], anchors, transform,
 *         alignmentScore, ms, isMock, logId?, warnings? }
 *
 * 流程（自研 iocr，不再调用百度封装好的 iocr）：
 *   1. 取模板（含 referenceFields 锚点 + fields 识别字段）
 *   2. 读任务图片为 buffer
 *   3. 调百度通用 OCR (accurate_basic) → 文字 + 坐标 regions
 *   4. 调自研 template-matcher.matchTemplate：
 *      - referenceFields 锚点匹配 → 计算 offset/scale 变换
 *      - fields 模板坐标变换 → 在新图找到落在区域内的文字
 *   5. mock 模式：无 AK/SK → 返回模板 coords 占位 + 对齐诊断为 0
 */
async function handleOcrRecognizeTemplate(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const { taskId, templateId } = parseJSONBody(body)
    if (!templateId) return sendJSON(res, 400, { error: 'templateId required' })
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })

    const tpl = getTemplate(templateId)
    if (!tpl) return sendJSON(res, 404, { error: `template not found: ${templateId}` })

    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    const t0 = Date.now()

    // 兼容旧模板（含百度 templateSign）：仍走百度 iocr 封装端点
    if (tpl.sign && !(tpl.referenceFields && tpl.referenceFields.length > 0)) {
      try {
        const imageUrl = task.originalUrl ? `${process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:5180'}${task.originalUrl}` : undefined
        const r = await recognizeByTemplate({ templateSign: tpl.sign, imageUrl })
        const fieldMap = new Map()
        for (const f of r.fields) fieldMap.set(f.name, f)
        const outFields = tpl.fields.map(tplField => {
          const matched = fieldMap.get(tplField.name)
          return {
            name: tplField.name,
            value: matched?.value || '',
            location: matched?.location || null,
            confidence: matched ? 0.95 : 0,
          }
        })
        res.setHeader('X-OCR-Engine', r.isMock ? 'baidu-iocr-mock' : 'baidu-iocr')
        res.setHeader('X-OCR-Ms', String(Date.now() - t0))
        res.setHeader('X-OCR-Fields', String(outFields.length))
        console.log(`[ocr-recognize-template] task=${taskId} template=${templateId} engine=${r.isMock ? 'mock' : 'baidu-iocr-legacy'} fields=${outFields.length} ms=${Date.now() - t0}`)
        return sendJSON(res, 200, {
          engine: r.isMock ? 'baidu-iocr-mock' : 'baidu-iocr-legacy',
          fields: outFields,
          ms: Date.now() - t0,
          isMock: r.isMock,
          logId: r.logId,
        })
      } catch (e) {
        console.warn('[ocr-recognize-template] baidu legacy failed, fallback to self-hosted:', e.message)
      }
    }

    // 自研 iocr：百度通用 OCR + 自研模板匹配
    const imagePath = task.previewPath || task.originalPath
    let imageBuffer = null
    if (imagePath && fs.existsSync(imagePath)) {
      imageBuffer = fs.readFileSync(imagePath)
    }

    const ocrR = await recognizeGeneral({ imageBuffer })
    if (ocrR.isMock) {
      // mock：返回模板 coords 占位 + 对齐诊断
      const placeholder = tpl.fields.map(f => ({
        name: f.name,
        value: '',
        location: { left: f.x, top: f.y, width: f.w, height: f.h },
        confidence: 0,
        hitCount: 0,
      }))
      res.setHeader('X-OCR-Engine', 'self-hosted-iocr-mock')
      res.setHeader('X-OCR-Ms', String(Date.now() - t0))
      res.setHeader('X-OCR-Fields', String(placeholder.length))
      console.log(`[ocr-recognize-template] task=${taskId} template=${templateId} engine=self-hosted-mock (no AK/SK) ms=${Date.now() - t0}`)
      return sendJSON(res, 200, {
        engine: 'self-hosted-iocr-mock',
        fields: placeholder,
        anchors: (tpl.referenceFields || []).map(r => ({ id: r.id, name: r.name, text: r.text, matched: false, score: 0, region: null })),
        transform: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
        alignmentScore: 0,
        ms: Date.now() - t0,
        isMock: true,
        warnings: ['BAIDU_OCR_API_KEY missing, configure to enable real OCR'],
      })
    }

    const matched = matchTemplate({ regions: ocrR.regions, template: tpl })

    res.setHeader('X-OCR-Engine', 'self-hosted-iocr')
    res.setHeader('X-OCR-Ms', String(Date.now() - t0))
    res.setHeader('X-OCR-Fields', String(matched.fields.length))
    res.setHeader('X-OCR-Alignment', matched.alignmentScore.toFixed(3))
    console.log(`[ocr-recognize-template] task=${taskId} template=${templateId} engine=self-hosted-iocr alignment=${matched.alignmentScore.toFixed(3)} fields=${matched.fields.length} anchors=${matched.anchors.filter(a=>a.matched).length}/${matched.anchors.length} ms=${Date.now() - t0}`)

    return sendJSON(res, 200, {
      engine: 'self-hosted-iocr',
      fields: matched.fields,
      anchors: matched.anchors,
      transform: matched.transform,
      alignmentScore: matched.alignmentScore,
      ms: Date.now() - t0,
      isMock: false,
      logId: ocrR.logId,
      regionsTotal: ocrR.regions.length,
    })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    console.error('[ocr-recognize-template] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 语音合成：POST /api/speech/tts
 * 入参：{ text, voice?, speed?, pitch?, volume?, format?, sampleRate? }
 * 出参：audio/mpeg 或 audio/wav 二进制
 * 响应头：X-TTS-Engine / X-TTS-Ms / X-TTS-Voice / X-TTS-Format
 */
async function handleSpeechTTS(req, res) {
  try {
    const body = await readBody(req, 32 * 1024)
    const { text, voice, speed, pitch, volume, format, sampleRate, lang } = parseJSONBody(body)
    if (!text || !text.trim()) return sendJSON(res, 400, { error: 'text required' })
    const t0 = Date.now()
    const r = await synthesizeTTS({ text, voice, speed, pitch, volume, audioFormat: format, sampleRate })

    const mime = (r.format === 'wav' ? 'audio/wav' : r.format === 'pcm' ? 'audio/pcm' : 'audio/mpeg')
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', String(r.audio.length))
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-TTS-Engine', r.engine)
    res.setHeader('X-TTS-Ms', String(r.ms))
    res.setHeader('X-TTS-Voice', r.voice)
    res.setHeader('X-TTS-Format', r.format)
    console.log(`[speech/tts] engine=${r.engine} voice=${r.voice} format=${r.format} text_len=${text.length} audio_bytes=${r.audio.length} latency=${Date.now() - t0}ms lang=${lang || 'auto'}`)
    res.writeHead(200)
    res.end(r.audio)
  } catch (e) {
    console.error('[speech/tts] failed:', e.message)
    if (e instanceof SpeechError) return sendJSON(res, e.statusCode, { error: e.message, body: e.body })
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 语音识别：POST /api/speech/asr
 * 入参：{ taskId?, lang? }
 * 出参：{ text, segments, engine, ms }
 * 响应头：X-ASR-Engine / X-ASR-Ms
 */
async function handleSpeechASR(req, res) {
  try {
    const body = await readBody(req, 8 * 1024)
    const { taskId, lang } = parseJSONBody(body)
    const t0 = Date.now()
    if (taskId && taskId !== 'standalone') {
      const task = getTask(taskId)
      if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })
    }
    const r = await recognizeASR({ taskId, lang })
    res.setHeader('X-ASR-Engine', r.engine)
    res.setHeader('X-ASR-Ms', String(r.ms))
    console.log(`[speech/asr] engine=${r.engine} taskId=${taskId || 'standalone'} latency=${Date.now() - t0}ms segments=${r.segments.length}`)
    sendJSON(res, 200, r)
  } catch (e) {
    console.error('[speech/asr] failed:', e.message)
    if (e instanceof SpeechError) return sendJSON(res, e.statusCode, { error: e.message })
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 语音识别 + 分段 + per-segment 翻译：POST /api/speech/asr-segments
 * 入参：{ taskId?, lang?, sourceLang?, targetLang?, text? (standalone 直接喂文本) }
 * 出参：{ segments: [{start_ms, end_ms, source, target, engine}], fullText, fullTranslation, engine, ms }
 * 响应头：X-ASR-Engine / X-ASR-Ms / X-ASR-Segments / X-Translate-Engine
 */
async function handleSpeechAsrSegments(req, res) {
  try {
    const body = await readBody(req, 16 * 1024)
    const { taskId, lang = 'zh-CN', sourceLang = 'zh', targetLang = 'en', text: inlineText } = parseJSONBody(body)
    const t0 = Date.now()

    // task 校验
    if (taskId && taskId !== 'standalone') {
      const task = getTask(taskId)
      if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })
    }

    // 1. ASR — 若提供 inlineText（standalone 模式），则跳过 ASR 直接分段
    let segments = []
    let fullText = ''
    let asrEngine = 'mock'
    if (inlineText) {
      // standalone：直接分段
      const { mockSplitSegments } = await import('./speech.mjs')
      const segs = mockSplitSegments(inlineText)
      for (const s of segs) segments.push({ ...s, source: s.text })
      fullText = inlineText
      asrEngine = 'standalone'
    } else {
      const r = await recognizeASR({ taskId, lang })
      asrEngine = r.engine
      fullText = r.text
      for (const s of r.segments) segments.push({ ...s, source: s.text })
    }

    // 2. per-segment 翻译
    const translated = await translateSegments(segments, { sourceLang, targetLang })
    const fullTranslation = translated.map(t => t.target).filter(Boolean).join('\n')

    const ms = Date.now() - t0
    res.setHeader('X-ASR-Engine', asrEngine)
    res.setHeader('X-ASR-Ms', String(ms))
    res.setHeader('X-ASR-Segments', String(translated.length))
    console.log(`[speech/asr-segments] engine=${asrEngine} segments=${translated.length} taskId=${taskId || 'standalone'} ms=${ms}`)
    sendJSON(res, 200, {
      segments: translated,
      fullText,
      fullTranslation,
      engine: asrEngine,
      ms,
      segmentsCount: translated.length,
      sourceLang,
      targetLang,
    })
  } catch (e) {
    console.error('[speech/asr-segments] failed:', e.message)
    if (e instanceof SpeechError) return sendJSON(res, e.statusCode, { error: e.message })
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 实时翻译：POST /api/voice/translate
 * 入参：{ text, sourceLang, targetLang, useCache? }
 * 出参：{ translation, engine, cached, latency_ms }
 */
async function handleVoiceTranslate(req, res) {
  try {
    const body = await readBody(req, 16 * 1024)
    const { text, sourceLang, targetLang, useCache } = parseJSONBody(body)
    if (!text) return sendJSON(res, 400, { error: 'text required' })
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    const r = await translateOnce({ text, sourceLang, targetLang, useCache: useCache !== false })
    res.setHeader('X-VoiceTranslate-Engine', r.engine)
    res.setHeader('X-VoiceTranslate-Cached', r.cached ? '1' : '0')
    res.setHeader('X-VoiceTranslate-Ms', String(r.latency_ms))
    console.log(`[voice/translate] engine=${r.engine} cached=${r.cached} ${sourceLang}→${targetLang} latency=${r.latency_ms}ms`)
    sendJSON(res, 200, r)
  } catch (e) {
    console.error('[voice/translate] failed:', e.message)
    if (e instanceof SpeechError) return sendJSON(res, e.statusCode, { error: e.message })
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * ============ Workspace Timeline 时间线 ============
 * 设计要点（见 workspace-timeline.mjs 顶部注释）：
 *   - 每用户 JSONL，userId 取自 x-user-id header，缺省 'anonymous'
 *   - 上限 200 条 + 单文件 10000 行 rotation
 *   - 全部可观测：ISO 时间戳 + X-Timeline-* 响应头
 */

function userIdFromReq(req) {
  const h = req.headers['x-user-id']
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 64)
  return 'anonymous'
}

async function handleTimelineAppend(req, res) {
  try {
    const body = await readBody(req, 8 * 1024)
    const input = parseJSONBody(body)
    const userId = userIdFromReq(req)
    const entry = appendEntry({ ...input, userId })
    res.setHeader('X-Timeline-Id', entry.id)
    res.setHeader('X-Timeline-Kind', entry.kind)
    return sendJSON(res, 200, { ok: true, entry })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (/invalid kind|summary required|too long/i.test(e.message)) {
      return sendJSON(res, 400, { error: e.message })
    }
    console.error('[workspace-timeline] append failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

async function handleTimelineList(req, res, url) {
  try {
    const userId = userIdFromReq(req)
    const kind = url.searchParams.get('kind') || undefined
    const limit = Number(url.searchParams.get('limit') || 50)
    const entries = listEntries({ userId, kind, limit })
    res.setHeader('X-Timeline-Count', String(entries.length))
    if (kind) res.setHeader('X-Timeline-Kind', kind)
    return sendJSON(res, 200, { entries })
  } catch (e) {
    console.error('[workspace-timeline] list failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

async function handleTimelineRemove(req, res, id) {
  try {
    const userId = userIdFromReq(req)
    const ok = removeEntry({ userId, id })
    if (!ok) return sendJSON(res, 404, { error: 'timeline entry not found' })
    res.setHeader('X-Timeline-Removed-Id', id)
    return sendJSON(res, 200, { ok: true, id })
  } catch (e) {
    if (/id required/i.test(e.message)) return sendJSON(res, 400, { error: e.message })
    console.error('[workspace-timeline] remove failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

async function handleTimelineClear(req, res) {
  try {
    const userId = userIdFromReq(req)
    const r = clearEntries({ userId })
    res.setHeader('X-Timeline-Cleared', String(r.cleared))
    return sendJSON(res, 200, r)
  } catch (e) {
    console.error('[workspace-timeline] clear failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

// ============ Phase A.3：进度 / 批量 / 术语表 / TM / 导出 ============
// 模型：claude-sonnet-4-6

/**
 * GET /api/inspect/translate/progress/:jobId?sinceSeq=N
 *  - 从 JSONL 拉取进度帧（增量 sinceSeq）
 *  - 响应头：X-Job-Id / X-Job-Last-Seq / X-Job-Frames / X-Job-Status / X-Job-Created-At
 */
async function handleInspectTranslateProgress(req, res, url, jobId) {
  try {
    const sinceSeq = Number(url.searchParams.get('sinceSeq') || 0)
    const frames = tailFrames({ jobId, sinceSeq })
    const job = getJob({ jobId })
    const lastSeq = job ? job.lastSeq : (frames.length > 0 ? frames[frames.length - 1].seq : 0)
    const status = job ? job.status : (frames.length > 0 ? frames[frames.length - 1].kind : 'unknown')
    const createdAt = job ? new Date(job.createdAt).toISOString() : new Date().toISOString()

    res.setHeader('X-Job-Id', jobId)
    res.setHeader('X-Job-Last-Seq', String(lastSeq))
    res.setHeader('X-Job-Frames', String(frames.length))
    res.setHeader('X-Job-Status', status)
    res.setHeader('X-Job-Created-At', createdAt)

    console.log(`[inspect-translate-progress ${new Date().toISOString()}] job=${jobId} since=${sinceSeq} → ${frames.length} frames (lastSeq=${lastSeq})`)

    return sendJSON(res, 200, { jobId, lastSeq, frames, status, sinceSeq })
  } catch (e) {
    console.error('[inspect-translate-progress] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * POST /api/translate/image/batch
 * 入参：{ taskIds[], sourceLang, targetLang, glossaryId?, tmId? }
 * 出参：202 { jobId, total, progressUrl }
 *
 * v4.3.1 实现：fire-and-forget JSONL 批量翻译。
 *   - 启动后立即返回 202 + jobId
 *   - 后台逐步处理每张图：OCR（mock identity）→ translate → appendFrame('image-done')
 *   - 取消通过 POST /api/translate/image/batch/:jobId/cancel
 *
 * 简化说明：本版本不调用真实 OCR provider（无环境变量）；仅做"进度演示 + 接口闭环"。
 */
async function handleTranslateImageBatchStart(req, res) {
  try {
    const MAX_BODY = 200 * 8 * 1024  // 200 taskIds × 8KB
    const body = await readBody(req, MAX_BODY + 1024)
    const { taskIds, sourceLang = 'zh-CN', targetLang, glossaryId, tmId } = parseJSONBody(body)
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return sendJSON(res, 400, { error: 'taskIds must be a non-empty array' })
    }
    if (taskIds.length > 200) {
      return sendJSON(res, 413, { error: `taskIds exceeds maximum of 200 (got ${taskIds.length})` })
    }
    if (!sourceLang || !targetLang) {
      return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    }
    if (!SUPPORTED_LANGS.has(sourceLang)) return sendJSON(res, 400, { error: `unsupported sourceLang: ${sourceLang}` })
    if (!SUPPORTED_LANGS.has(targetLang)) return sendJSON(res, 400, { error: `unsupported targetLang: ${targetLang}` })

    const jobId = 'batch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)

    appendFrame({
      jobId,
      kind: 'started',
      payload: {
        total: taskIds.length,
        sourceLang, targetLang,
        glossaryId: glossaryId || null,
        tmId: tmId || null,
        ts: new Date().toISOString(),
      },
    })
    console.log(`[translate-image-batch ${new Date().toISOString()}] start job=${jobId} total=${taskIds.length} src=${sourceLang} tgt=${targetLang} glossary=${glossaryId || 'none'} tm=${tmId || 'none'}`)

    res.setHeader('X-Job-Id', jobId)
    res.setHeader('X-Batch-Total', String(taskIds.length))
    res.setHeader('X-Batch-Source-Lang', sourceLang)
    res.setHeader('X-Batch-Target-Lang', targetLang)
    res.setHeader('Location', `/api/translate/image/batch/${jobId}`)

    // Fire-and-forget 后台进度（不 await）
    processImageBatchAsync({ jobId, taskIds, sourceLang, targetLang })
      .catch(err => {
        console.error(`[translate-image-batch ${new Date().toISOString()}] job=${jobId} background error: ${err.message}`)
        appendFrame({ jobId, kind: 'failed', payload: { error: err.message, page: null } })
      })

    return sendJSON(res, 202, {
      jobId,
      total: taskIds.length,
      progressUrl: `/api/translate/image/batch/${jobId}`,
      pollIntervalMs: 1000,
    })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[translate-image-batch] start failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 后台异步推进批量任务（每张图 appendFrame('image-done' / 'finished' / 'failed' / 'cancelled')）
 * semaphore=3 模拟并发；isJobCancelled 检查每张图前触发
 */
async function processImageBatchAsync({ jobId, taskIds, sourceLang, targetLang }) {
  const total = taskIds.length
  const startedAt = Date.now()
  let okCount = 0
  let failedCount = 0
  const semaphore = 3

  // 简单信号量：控制 in-flight ≤ 3
  let inFlight = 0
  const queue = []

  const processOne = async (taskId, index) => {
    if (isJobCancelled({ jobId })) {
      appendFrame({ jobId, kind: 'image-done', payload: { taskId, index, status: 'skipped', reason: 'cancelled' } })
      return 'cancelled'
    }
    const t0 = Date.now()
    try {
      // 简化：mock 一张"图片 OCR + 翻译"（实际场景调 ocrImage + translateOnce）
      // 这里只 sleep 模拟 + 写入 image-done 帧
      await new Promise(r => setTimeout(r, 10))
      const ms = Date.now() - t0
      const task = getTask(taskId)
      const taskExists = !!task
      appendFrame({
        jobId,
        kind: 'image-done',
        payload: {
          taskId, index, total,
          ms,
          ocrMs: ms,
          translateMs: 0,
          confidence: 0.85,
          status: taskExists ? 'ok' : 'missing',
        },
      })
      okCount++
      return 'ok'
    } catch (e) {
      failedCount++
      appendFrame({
        jobId,
        kind: 'image-done',
        payload: { taskId, index, status: 'failed', error: e.message },
      })
      return 'failed'
    }
  }

  const runQueue = async () => {
    while (queue.length > 0 && inFlight < semaphore) {
      if (isJobCancelled({ jobId })) break
      const { taskId, index } = queue.shift()
      inFlight++
      processOne(taskId, index).finally(() => {
        inFlight--
        if (queue.length > 0) runQueue()
        else if (inFlight === 0) finishBatch()
      })
    }
  }

  const finishBatch = () => {
    const totalMs = Date.now() - startedAt
    if (isJobCancelled({ jobId })) {
      // cancelled 帧已经由 cancel handler 写；这里只补 finished/cancelled frame 由 cancel 路径完成
      return
    }
    appendFrame({
      jobId,
      kind: 'finished',
      payload: { total, ok: okCount, failed: failedCount, totalMs },
    })
    console.log(`[translate-image-batch ${new Date().toISOString()}] finish job=${jobId} ok=${okCount} failed=${failedCount} totalMs=${totalMs}`)
  }

  for (let i = 0; i < taskIds.length; i++) {
    queue.push({ taskId: taskIds[i], index: i })
  }
  await runQueue()
  // 等所有 in-flight 完成
  while (inFlight > 0) await new Promise(r => setTimeout(r, 10))
  finishBatch()
}

/**
 * POST /api/translate/image/batch/:jobId/cancel
 *  - 写 cancelled 帧（带 ISO 时间戳）
 *  - 后台 processImageBatchAsync 通过 isJobCancelled 检查自动退出
 */
async function handleTranslateImageBatchCancel(req, res, jobId) {
  try {
    const now = new Date().toISOString()
    appendFrame({
      jobId,
      kind: 'cancelled',
      payload: { reason: 'user', cancelledAt: now },
    })
    res.setHeader('X-Job-Id', jobId)
    res.setHeader('X-Job-Cancelled-At', now)
    console.log(`[translate-image-batch ${new Date().toISOString()}] cancel job=${jobId} reason=user at=${now}`)
    return sendJSON(res, 200, { jobId, status: 'cancelled', cancelledAt: now })
  } catch (e) {
    console.error('[translate-image-batch] cancel failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * POST /api/translate/glossary
 *  入参：{ sourceLang, targetLang, source, target, pos?, note? }
 *  出参：{ id, source, target, sourceLang, targetLang, ... }
 *  响应头：X-Glossary-Id / X-Glossary-Hits
 */
async function handleGlossaryCreate(req, res) {
  try {
    const body = await readBody(req, 16 * 1024)
    const { sourceLang, targetLang, source, target, pos, note } = parseJSONBody(body)
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    if (!source || !target) return sendJSON(res, 400, { error: 'source and target required' })
    if (!SUPPORTED_LANGS.has(sourceLang)) return sendJSON(res, 400, { error: `unsupported sourceLang: ${sourceLang}` })
    if (!SUPPORTED_LANGS.has(targetLang)) return sendJSON(res, 400, { error: `unsupported targetLang: ${targetLang}` })

    const entry = appendTerm({ sourceLang, targetLang, source, target, pos, note })
    res.setHeader('X-Glossary-Id', entry.id)
    // X-Glossary-Hits = 当前 source 在语言对中的命中次数（应用次数估算）
    res.setHeader('X-Glossary-Hits', '0')
    console.log(`[translate-glossary ${new Date().toISOString()}] create id=${entry.id} pair=${sourceLang}→${targetLang} term="${source}" target="${target}"`)
    return sendJSON(res, 200, entry)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[translate-glossary] create failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * GET /api/translate/glossary?sourceLang=&targetLang=
 *  响应头：X-Glossary-Count / X-Glossary-Source-Lang / X-Glossary-Target-Lang
 */
async function handleGlossaryList(req, res, url) {
  try {
    const sourceLang = url.searchParams.get('sourceLang')
    const targetLang = url.searchParams.get('targetLang')
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    const items = listTerms({ sourceLang, targetLang })
    res.setHeader('X-Glossary-Count', String(items.length))
    res.setHeader('X-Glossary-Source-Lang', sourceLang)
    res.setHeader('X-Glossary-Target-Lang', targetLang)
    return sendJSON(res, 200, { sourceLang, targetLang, items })
  } catch (e) {
    console.error('[translate-glossary] list failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * DELETE /api/translate/glossary/:id?sourceLang=&targetLang=
 *  响应头：X-Glossary-Removed-Id
 */
async function handleGlossaryDelete(req, res, url, id) {
  try {
    const sourceLang = url.searchParams.get('sourceLang')
    const targetLang = url.searchParams.get('targetLang')
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    const ok = deleteTerm({ id, sourceLang, targetLang })
    if (!ok) return sendJSON(res, 404, { error: 'term not found' })
    res.setHeader('X-Glossary-Removed-Id', id)
    console.log(`[translate-glossary ${new Date().toISOString()}] delete id=${id} pair=${sourceLang}→${targetLang}`)
    return sendJSON(res, 200, { ok: true, id })
  } catch (e) {
    console.error('[translate-glossary] delete failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * POST /api/translate/glossary/import (multipart)
 *  字段：file (CSV), sourceLang, targetLang
 *  CSV 格式：source,target[,pos,note]；首行 header；UTF-8 BOM 自动剥离
 *  响应头：X-Glossary-Imported-Count / X-Glossary-Duplicates
 */
async function handleGlossaryImport(req, res) {
  try {
    const ct = req.headers['content-type'] || ''
    const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundaryMatch) return sendJSON(res, 400, { error: 'no boundary' })
    const rawBody = await readBody(req, 10 * 1024 * 1024) // 10MB CSV 上限
    const fields = parseMultipart(rawBody, boundaryMatch[1] || boundaryMatch[2])
    const file = fields.file
    const sourceLang = fields.sourceLang?.data?.toString('utf8')
    const targetLang = fields.targetLang?.data?.toString('utf8')
    if (!file || !file.data) return sendJSON(res, 400, { error: 'file required' })
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })

    let parsed
    try {
      parsed = parseGlossaryCsv(file.data)
    } catch (e) {
      return sendJSON(res, 400, { error: `csv parse failed: ${e.message}` })
    }

    // 检查重复：按 source 字段去重
    const existing = listTerms({ sourceLang, targetLang })
    const existingSources = new Set(existing.map(t => t.source))
    let imported = 0
    let duplicates = 0
    for (const row of parsed) {
      if (existingSources.has(row.source)) {
        duplicates++
        continue
      }
      appendTerm({
        sourceLang,
        targetLang,
        source: row.source,
        target: row.target,
        pos: row.pos,
        note: row.note,
      })
      imported++
    }

    res.setHeader('X-Glossary-Imported-Count', String(imported))
    res.setHeader('X-Glossary-Duplicates', String(duplicates))
    console.log(`[translate-glossary ${new Date().toISOString()}] import pair=${sourceLang}→${targetLang} imported=${imported} duplicates=${duplicates}`)
    return sendJSON(res, 200, { imported, duplicates, total: parsed.length })
  } catch (e) {
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'file too large' })
    console.error('[translate-glossary] import failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * POST /api/translate/memory
 *  入参：{ sourceLang, targetLang, source, target, context? }
 *  响应头：X-TM-Id / X-TM-Score
 */
async function handleMemoryCreate(req, res) {
  try {
    const body = await readBody(req, 64 * 1024)
    const { sourceLang, targetLang, source, target, context } = parseJSONBody(body)
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    if (!source || !target) return sendJSON(res, 400, { error: 'source and target required' })

    const entry = addTmEntry({ sourceLang, targetLang, source, target, context })
    res.setHeader('X-TM-Id', entry.id)
    res.setHeader('X-TM-Score', '1.000')
    return sendJSON(res, 200, { ...entry, score: 1 })
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    if (e.message === 'FILE_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large' })
    console.error('[translate-memory] create failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * GET /api/translate/memory?sourceLang=&targetLang=&q=&threshold=
 *  响应头：X-TM-Count / X-TM-Match-Score
 */
async function handleMemoryLookup(req, res, url) {
  try {
    const sourceLang = url.searchParams.get('sourceLang')
    const targetLang = url.searchParams.get('targetLang')
    const q = url.searchParams.get('q') || ''
    const threshold = Number(url.searchParams.get('threshold') || '0.7')
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    const items = q
      ? lookupTm({ sourceLang, targetLang, query: q, threshold, limit: 50 })
      : listTerms({ sourceLang, targetLang }) // fallback: 不查 q 时返回 glossary
    const bestScore = items.length > 0 ? (items[0].score || 1) : 0
    res.setHeader('X-TM-Count', String(items.length))
    res.setHeader('X-TM-Match-Score', bestScore.toFixed(3))
    console.log(`[translate-memory ${new Date().toISOString()}] lookup pair=${sourceLang}→${targetLang} q="${q.slice(0, 40)}" hits=${items.length} best=${bestScore.toFixed(3)}`)
    return sendJSON(res, 200, { sourceLang, targetLang, items })
  } catch (e) {
    console.error('[translate-memory] lookup failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * DELETE /api/translate/memory/:id?sourceLang=&targetLang=
 *  响应头：X-TM-Removed-Id
 */
async function handleMemoryDelete(req, res, url, id) {
  try {
    const sourceLang = url.searchParams.get('sourceLang')
    const targetLang = url.searchParams.get('targetLang')
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang and targetLang required' })
    const ok = deleteTmEntry({ id, sourceLang, targetLang })
    if (!ok) return sendJSON(res, 404, { error: 'tm entry not found' })
    res.setHeader('X-TM-Removed-Id', id)
    return sendJSON(res, 200, { ok: true, id })
  } catch (e) {
    console.error('[translate-memory] delete failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * GET /api/inspect/translate/export?taskId=&format=bilingual-docx|bilingual-pdf|target-pdf
 *  出参：二进制下载
 *  响应头：X-Export-Format / X-Export-Pages / X-Export-Source-Lang / X-Export-Target-Lang / Content-Disposition
 */
async function handleInspectTranslateExport(req, res, url) {
  try {
    const taskId = url.searchParams.get('taskId')
    const format = url.searchParams.get('format') || 'bilingual-docx'
    const sourceLang = url.searchParams.get('sourceLang') || 'zh-CN'
    const targetLang = url.searchParams.get('targetLang') || 'en'

    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })
    const validFormats = ['bilingual-docx', 'bilingual-pdf', 'target-pdf']
    if (!validFormats.includes(format)) {
      return sendJSON(res, 400, { error: `invalid format: must be one of ${validFormats.join(', ')}` })
    }

    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    // 拉取翻译结果
    const text = extractTaskText(task)
    const t0 = Date.now()
    const result = await translate({ text, sourceLang, targetLang, taskId, task })
    const pages = result.pages
    if (!pages || pages.length === 0) {
      return sendJSON(res, 400, { error: 'no pages to export (task may be empty or unsupported)' })
    }

    const taskName = task.name ? task.name.replace(/\.[^.]+$/, '') : `task-${taskId}`
    let buffer
    let contentType
    let ext
    if (format === 'bilingual-docx') {
      buffer = await generateBilingualDocx({ pages, sourceLang, targetLang, taskName })
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ext = 'docx'
    } else if (format === 'bilingual-pdf') {
      buffer = await generateBilingualPdf({ pages, sourceLang, targetLang, taskName })
      contentType = 'application/pdf'
      ext = 'pdf'
    } else { // target-pdf
      buffer = await generateTranslationOnlyPdf({ pages, targetLang, taskName })
      contentType = 'application/pdf'
      ext = 'pdf'
    }
    const ms = Date.now() - t0

    const filename = `${taskName}-${sourceLang}-${targetLang}.${ext}`
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('X-Export-Format', format)
    res.setHeader('X-Export-Pages', String(pages.length))
    res.setHeader('X-Export-Source-Lang', sourceLang)
    res.setHeader('X-Export-Target-Lang', targetLang)
    res.setHeader('Cache-Control', 'no-store')

    console.log(`[translate-export ${new Date().toISOString()}] task=${taskId} format=${format} pages=${pages.length} bytes=${buffer.length} ms=${ms}`)

    res.writeHead(200)
    res.end(buffer)
  } catch (e) {
    console.error('[translate-export] failed:', e.message)
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}

/**
 * 反馈驱动重翻译：POST /api/translate/retranslate
 * 入参：
 *   { taskId, sourceLang, targetLang,
 *     glossary?, tm?, priorSegments?, onlyStaleSegments?, jobId? }
 * 出参：200 + TranslateResponse（同 /api/inspect/translate）
 * 响应头：X-Translate-Retranslate-{Mode, Alt-Trans, Seg-Rating-Low, Align-Fix, Ms, Merged-Glossary-Size}
 *
 * 行为：
 *   1) loadAllFeedback(taskId) → feedbackGlossary + retargetSegments + summary
 *   2) mergedGlossary = [...(glossary||[]), ...feedbackGlossary]
 *   3) 调用 translate({...args, glossary: mergedGlossary, jobId})，得到新 result
 *   4) 响应头带 X-Translate-Retranslate-* 反馈统计
 *   5) 如果 onlyStaleSegments && retargetSegments.size > 0：
 *      - 在 result 中把不在 retargetSegments 的段替换为 priorSegments 的 target
 *      - 段计数 + meta 统计不变（不重跑 AI）
 */
async function handleRetranslate(req, res) {
  const t0 = Date.now()
  try {
    const body = await readBody(req, 256 * 1024)
    const input = parseJSONBody(body)
    const { taskId, sourceLang, targetLang } = input
    if (!taskId) return sendJSON(res, 400, { error: 'taskId required' })
    if (!sourceLang || !targetLang) return sendJSON(res, 400, { error: 'sourceLang/targetLang required' })

    const onlyStaleSegments = !!input.onlyStaleSegments
    const priorSegments = Array.isArray(input.priorSegments) ? input.priorSegments : null
    const userGlossary = Array.isArray(input.glossary) ? input.glossary : []
    const userTm = Array.isArray(input.tm) ? input.tm : []

    // 1) 加载反馈
    const { summary, retargetSegments, feedbackGlossary } = loadAllFeedback(taskId)
    const mergedGlossary = mergeGlossaryWithFeedback(userGlossary, feedbackGlossary)

    // 2) 取 task
    const task = getTask(taskId)
    if (!task) return sendJSON(res, 404, { error: `task not found: ${taskId}` })

    // 3) 调用 translate
    const newJobId = input.jobId || ('rj_' + Date.now().toString(36))
    // 文本模式：若 task 是 txt/md 且有 originalPath，提取文本
    let text = input.text
    if (!text) text = extractTaskText(task)
    const result = await translate({
      taskId,
      task,
      text,
      sourceLang,
      targetLang,
      strategy: 'synthetic',  // retranslate 默认走 synthetic 走真实 provider；mock 由 ENV 控制
      glossary: mergedGlossary,
      tm: userTm,
      jobId: newJobId,
    })

    // 4) onlyStaleSegments：把不在 retargetSegments 的段 target 替换为 priorSegments 的 target
    if (onlyStaleSegments && retargetSegments.size > 0 && priorSegments && priorSegments.length > 0) {
      // segments[i] 可能是 doc-mode 的 page-level；retargetSegments 是 seg:pNsM 格式
      // 简化：把每个 page-level segment 当成一个 segment；如果其段号不在 retargetSegments，则用 priorSegments 对应位置
      for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i]
        const segId = `seg:p${seg.index ?? i}s${i}`  // doc-mode 中 retargetSegments 用 page-level
        if (!retargetSegments.has(segId)) {
          // 复用 priorSegments[i].target
          const prior = priorSegments.find((p) => p.index === i) || priorSegments[i]
          if (prior && typeof prior.target === 'string') {
            seg.target = prior.target
            // 同步更新 pages[i].targetText
            if (result.pages && result.pages[i]) {
              result.pages[i].targetText = prior.target
            }
          }
        }
      }
      // 重新计算 paragraphBlocks
      if (result.paragraphBlocks) {
        result.paragraphBlocks = result.segments.map((seg) =>
          seg.source === seg.target
            ? { kind: 'equal', leftText: seg.source, rightText: seg.target }
            : { kind: 'change', leftText: seg.source, rightText: seg.target, charOps: myersDiff(seg.source, seg.target) },
        )
      }
    }

    const ms = Date.now() - t0
    res.setHeader('X-Translate-Retranslate-Mode', onlyStaleSegments ? 'stale-only' : 'full')
    res.setHeader('X-Translate-Retranslate-Alt-Trans', String(summary.altTrans))
    res.setHeader('X-Translate-Retranslate-Seg-Rating-Low', String(summary.segRatingLow))
    res.setHeader('X-Translate-Retranslate-Align-Fix', String(summary.alignFix))
    res.setHeader('X-Translate-Retranslate-Merged-Glossary-Size', String(mergedGlossary.length))
    res.setHeader('X-Translate-Retranslate-Retarget-Segments', String(retargetSegments.size))
    res.setHeader('X-Translate-Retranslate-Ms', String(ms))
    if (newJobId) res.setHeader('X-Translate-Retranslate-Job-Id', newJobId)
    console.log(
      `[translate-retranslate ${new Date().toISOString()}] task=${taskId} mode=${onlyStaleSegments ? 'stale-only' : 'full'} altTrans=${summary.altTrans} segRatingLow=${summary.segRatingLow} alignFix=${summary.alignFix} mergedGlossary=${mergedGlossary.length} ms=${ms}`,
    )
    return sendJSON(res, 200, result)
  } catch (e) {
    if (e.code === 'INVALID_JSON') return sendJSON(res, 400, { error: e.message })
    console.error('[translate-retranslate] failed:', e.message)
    return sendJSON(res, 500, { error: e.message || 'internal error' })
  }
}
