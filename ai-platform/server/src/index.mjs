// AI 平台服务器入口
// 模型：claude-sonnet-4-6
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { CONFIG, SUPPORTED_LANG_SET } from './config.mjs'
import { translateAI, getAvailableProviders } from './translate-provider.mjs'
import { translate, SUPPORTED_LANGS } from './translate.mjs'
import { myersDiff, summarizeErrors, groupByHunk, charDiffToRenderTokens, paragraphDiff, segmentWords, detectPhraseErrors, aiQualityCheck } from './diff.mjs'
import { ocrImage, compareOCRResults } from './ocr.mjs'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Multer for file uploads
const uploadDir = CONFIG.UPLOAD_DIR
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    cb(null, id + '_' + Buffer.from(file.originalname, 'latin1').toString('utf8'))
  }
})
const upload = multer({ storage, limits: { fileSize: CONFIG.MAX_FILE_SIZE } })

// In-memory task store
const tasks = new Map()

// ============ Health ============
app.get('/api/health', (_req, res) => res.json({ ok: true, t: Date.now() }))

app.get('/api/health/translate', (_req, res) => {
  res.json({ ok: true, providers: getAvailableProviders(), active: process.env.TRANSLATE_PROVIDER || 'mock' })
})

app.get('/api/health/ocr', (_req, res) => {
  res.json({ ok: true, providers: getAvailableProviders().filter(p => p !== 'mock'), modes: ['ai-vision', 'heuristic'] })
})

// ============ Upload & Tasks ============
app.post('/api/upload', upload.single('file'), (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'missing file' })
  const task = {
    id: file.filename.split('_')[0],
    name: file.originalname,
    size: file.size,
    ext: path.extname(file.originalname).toLowerCase().slice(1),
    originalPath: file.path,
    originalUrl: `/api/files/${file.filename.split('_')[0]}`,
    createdAt: Date.now(),
    status: 'ready',
  }
  tasks.set(task.id, task)
  console.log(`[upload] ${task.name} ${task.size}B → ${task.id}`)
  res.json({ ok: true, task })
})

app.get('/api/tasks', (_req, res) => {
  const list = Array.from(tasks.values()).map(({ originalPath, ...rest }) => rest)
  res.json({ tasks: list })
})

app.get('/api/files/:id', (req, res) => {
  const task = tasks.get(req.params.id)
  if (!task || !fs.existsSync(task.originalPath)) return res.status(404).json({ error: 'file not found' })
  res.setHeader('Content-Type', task.mime || 'application/octet-stream')
  fs.createReadStream(task.originalPath).pipe(res)
})

// ============ Translate ============
app.post('/api/translate', async (req, res) => {
  try {
    const { text, sourceLang = 'zh-CN', targetLang } = req.body
    if (!text) return res.status(400).json({ error: 'text required' })
    if (!targetLang) return res.status(400).json({ error: 'targetLang required' })
    if (!SUPPORTED_LANG_SET.has(targetLang)) return res.status(400).json({ error: `unsupported targetLang: ${targetLang}` })
    if (!SUPPORTED_LANG_SET.has(sourceLang)) return res.status(400).json({ error: `unsupported sourceLang: ${sourceLang}` })

    const result = await translate({ text, sourceLang, targetLang })
    res.setHeader('X-Translate-Engine', result.meta.engine)
    res.setHeader('X-Translate-Ms', String(result.ms))
    console.log(`[translate] ${sourceLang}→${targetLang} chars=${text.length} ms=${result.ms}`)
    res.json(result)
  } catch (e) {
    console.error('[translate] failed:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ============ Diff / Inspect ============
app.post('/api/inspect/diff', (req, res) => {
  try {
    const MAX = 200 * 1024
    const { left = '', right = '', granularity = 'char' } = req.body
    if (typeof left !== 'string' || typeof right !== 'string') return res.status(400).json({ error: 'left/right must be string' })
    if (left.length > MAX || right.length > MAX) return res.status(413).json({ error: 'text too long' })

    const t0 = Date.now()
    const ops = myersDiff(left, right)
    const errors = summarizeErrors(ops)
    const hunks = groupByHunk(ops)
    const tokens = charDiffToRenderTokens(ops)
    let paragraphBlocks
    if (granularity === 'paragraph') paragraphBlocks = paragraphDiff(left, right)
    const ms = Date.now() - t0

    res.setHeader('X-Diff-Ms', String(ms))
    res.setHeader('X-Diff-Errors', String(errors.length))
    console.log(`[inspect-diff] left=${left.length}B right=${right.length}B errors=${errors.length} ms=${ms}`)
    res.json({ ops, errors, hunks, tokens, ...(paragraphBlocks ? { paragraphBlocks } : {}), ms, meta: { granularity, leftChars: Array.from(left).length, rightChars: Array.from(right).length, errorCount: errors.length } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/inspect/quality-check', async (req, res) => {
  try {
    const MAX = 200 * 1024
    const { text = '' } = req.body
    if (typeof text !== 'string') return res.status(400).json({ error: 'text must be string' })
    if (text.length > MAX) return res.status(413).json({ error: 'text too long' })

    const result = await aiQualityCheck(text)
    res.setHeader('X-QC-Engine', result.engine)
    res.setHeader('X-QC-Ms', String(result.ms))
    console.log(`[quality-check] engine=${result.engine} errors=${result.errors.length} ms=${result.ms}`)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/inspect/phrase-errors', (req, res) => {
  try {
    const { left = '', right = '' } = req.body
    const t0 = Date.now()
    const errors = detectPhraseErrors(left, right)
    const tokensLeft = segmentWords(left)
    const tokensRight = segmentWords(right)
    const ms = Date.now() - t0
    res.setHeader('X-Phrase-Ms', String(ms))
    console.log(`[phrase-errors] left=${left.length}B right=${right.length}B errors=${errors.length} ms=${ms}`)
    res.json({ errors, tokens_left: tokensLeft, tokens_right: tokensRight, ms })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ============ OCR ============
app.post('/api/ocr/recognize', async (req, res) => {
  try {
    const { imagePath } = req.body
    if (!imagePath) return res.status(400).json({ error: 'imagePath required' })
    if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'image not found' })

    const result = await ocrImage(imagePath)
    res.setHeader('X-OCR-Engine', result.engine)
    res.setHeader('X-OCR-Ms', String(result.ms))
    console.log(`[ocr] engine=${result.engine} text=${result.text?.length||0} ms=${result.ms}`)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/ocr/compare', (req, res) => {
  try {
    const { reference = '', test = '' } = req.body
    if (typeof reference !== 'string' || typeof test !== 'string') return res.status(400).json({ error: 'reference/test must be string' })
    const result = compareOCRResults(reference, test)
    console.log(`[ocr-compare] ref=${reference.length}B test=${test.length}B errors=${result.errors.length}`)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Start
app.listen(CONFIG.PORT, () => {
  console.log(`[server] AI Platform ready on http://localhost:${CONFIG.PORT}`)
  console.log(`[server] Translate providers: ${getAvailableProviders().join(', ')}`)
  console.log(`[server] OCR: ${getAvailableProviders().some(p => p !== 'mock') ? 'AI enabled' : 'heuristic only'}`)
})
