// 单页译文渲染 — DOCX→PDF→PDFium 栅格化 + 文字层
// 模型：claude-sonnet-4-6
//
// 管线（v3.1 'synthetic'）：translated text → 临时 HTML（带 CSS 排版） → soffice 转 PDF
//      → PDFium renderPageToPng (image) + pdfiumExtractTextLayer (HTML spans)
//
// 管线（v4.0 'passthrough'）：直接复用源 page.png + PDFium 从源 PDF 提 runs
//      → buildFullDocTextLayer (v6, data-pdfium="6") + global charMap
//      跳过 soffice 二次转换 → 保留 DOCX 原排版（图片、表格、字体）
//
// 缓存：磁盘缓存 + 内存缓存，避免重复渲染同页
//   .data/translate-render-cache/{taskId}/{targetLang}/page-{n}.{png,html}

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'
import { convertWithSoffice } from './converter.mjs'
import { getTask } from './store.mjs'
import {
  rasterizeThumb,
  imageDimensions
} from './pdf-rasterize.mjs'
import { buildTextLayerWithCharMap, buildFullDocTextLayer } from './pdfium-text-layer.mjs'
import { pdfiumExtractTextRuns } from './pdfium-render.mjs'

const CACHE_ROOT = path.join(CONFIG.DATA_DIR, 'translate-render-cache')
const TMP_ROOT = path.join(CONFIG.DATA_DIR, 'translate-tmp')

// ============ 内存 LRU 缓存（最近 32 页） ============
const memCache = new Map() // key → { imagePath, textPath, pageW, pageH, ms, ts }
const MEM_CACHE_MAX = 32

// ============ 并发锁：防止同 key 并发触发重复 soffice 渲染 ============
// 多个并发的 render-image + render-text 请求会触发同一 key 多次 soffice 转换，
// 互相覆盖 tmp HTML/PDF 文件导致竞态。把 in-flight 的 promise 缓存起来去重。
const inflightRenders = new Map() // key → Promise<result>

function memGet(key) {
  const v = memCache.get(key)
  if (!v) return null
  memCache.delete(key)
  memCache.set(key, v) // LRU：重新插入到末尾
  return v
}
function memSet(key, val) {
  if (memCache.has(key)) memCache.delete(key)
  memCache.set(key, val)
  if (memCache.size > MEM_CACHE_MAX) {
    // 删除最早插入的
    const first = memCache.keys().next().value
    if (first) memCache.delete(first)
  }
}

// ============ 排版 HTML（用 CSS 模拟文档页面）============
/**
 * 把一段文本包成 A4 页面 HTML（A4 794×1123，模拟 Word 排版）
 * 用 HTML 而非纯 TXT：让 soffice 走更可靠的 HTML→PDF 链路（纯 TXT 转 PDF 在中文环境下字体回退差）
 * @param {string} text
 * @param {string} lang
 * @returns {string}
 */
function buildTranslatedHtml(text, lang) {
  // HTML 实体转义
  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = text.split('\n').map(l => `<p>${esc(l) || '<br/>'}</p>`).join('\n')
  // A4 页面：794x1123px @ 96dpi；中文字体优先级
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 20mm; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 794px; min-height: 1123px;
    padding: 80px 72px 80px 72px;
    box-sizing: border-box;
    font-family: "Microsoft YaHei", "PingFang SC", "SimSun", "Songti SC", "Times New Roman", serif;
    font-size: 14px;
    line-height: 1.85;
    color: #000;
    background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  p {
    margin: 0 0 6px;
    text-indent: 2em;
    word-break: break-word;
    white-space: pre-wrap;
  }
</style>
</head>
<body>
${paragraphs}
</body>
</html>`
}

// ============ 公共 API ============

/**
 * 渲染单页译文为 image + text layer
 * @param {{ taskId: string, pageNum: number, sourceText: string, targetLang: string, targetText?: string, charMap?: Array, strategy?: 'synthetic'|'passthrough' }} opts
 * @returns {Promise<{ imagePath: string, textPath: string, pageW: number, pageH: number, cached: boolean, ms: number }>}
 */
export async function renderTranslatedPage({ taskId, pageNum, sourceText, targetLang, targetText, charMap, strategy }) {
  // v4.0：passthrough 策略走简化路径（DOCX/PDF 保留原格式）
  //   - imagePath = 源 page.png（无 soffice 二次转换）
  //   - textPath = v6 fullDoc 文字层（data-pdfium="6"）
  if (strategy === 'passthrough') {
    return renderPassthroughPage({ taskId, pageNum, targetLang, sourceText, targetText, charMap })
  }
  return renderSyntheticPage({ taskId, pageNum, sourceText, targetLang, targetText, charMap })
}

/**
 * 渲染 passthrough 页面（DOCX/PDF 保留原格式）
 *  - 复用源 page.png + 源 PDF 提 runs → buildFullDocTextLayer (v6)
 *  - 跳过 soffice 二次转换
 *
 * @param {{ taskId: string, pageNum: number, targetLang: string, sourceText: string, targetText: string, charMap: Array }} opts
 */
async function renderPassthroughPage({ taskId, pageNum, targetLang, sourceText, targetText, charMap }) {
  const t0 = Date.now()

  // 1. 取 task + source page（pageNum 越界直接抛错）
  //    支持两种 pageNum 语义：
  //      - 1-based 数组下标（task.pages[i]）
  //      - 1-based 业务 page 编号（task.pages[i].page === pageNum）
  const task = getTask(taskId)
  if (!task) throw new Error(`task ${taskId} not found`)
  const pages = Array.isArray(task.pages) ? task.pages : []
  const srcPage = pages.find(p => p && p.page === pageNum) || pages[pageNum - 1]
  if (!srcPage) throw new Error(`page ${pageNum} not found in task ${taskId}`)

  const pageW = srcPage.width || 1239
  const pageH = srcPage.height || 1752
  const pad3 = String(pageNum).padStart(3, '0')

  // 2. 构造缓存 key（带 strategy 命名空间，避免与 synthetic 互踩）
  const key = `passthrough:${taskId}:${pageNum}:${targetLang}`

  // 3. 内存缓存
  const mc = memGet(key)
  if (mc) {
    console.info(`[translate-render] mem-hit ${key} (${mc.ms}ms cached, +${Date.now() - t0}ms lookup)`)
    return { ...mc, cached: true, ms: mc.ms, lookupMs: Date.now() - t0 }
  }

  // 4. 磁盘缓存（必须包含 data-pdfium="6"，否则视为过期自动重生）
  const cacheDir = path.join(CACHE_ROOT, taskId, targetLang)
  const cachePng = path.join(cacheDir, `page-${pad3}.png`)
  const cacheHtml = path.join(cacheDir, `page-${pad3}.html`)
  const sourcePng = task.pagesDir ? path.join(task.pagesDir, `page-${pad3}.png`) : cachePng
  if (fs.existsSync(cacheHtml)) {
    // 版本嗅探：旧版（v5 含 charMap，v4 run-level）自动失效
    let cached = null
    try {
      const head = fs.readFileSync(cacheHtml, 'utf-8').slice(0, 256)
      if (head.includes('data-pdfium="6"')) {
        cached = {
          imagePath: sourcePng,
          textPath: cacheHtml,
          pageW,
          pageH,
          ms: 0,
        }
      } else {
        console.info(`[translate-render] passthrough disk-stale ${key} (regenerate v6)`)
        try { fs.unlinkSync(cacheHtml) } catch {}
      }
    } catch {}
    if (cached) {
      memSet(key, cached)
      console.info(`[translate-render] passthrough disk-hit ${key} ${pageW}x${pageH} (${Date.now() - t0}ms lookup)`)
      return { ...cached, cached: true, ms: 0, lookupMs: Date.now() - t0 }
    }
  }

  // 5. 并发去重
  if (inflightRenders.has(key)) {
    console.info(`[translate-render] passthrough inflight-dedupe ${key} (${Date.now() - t0}ms wait)`)
    const result = await inflightRenders.get(key)
    return { ...result, cached: false, ms: result.ms, lookupMs: Date.now() - t0 }
  }

  // 6. 渲染管线
  const renderPromise = doRenderPassthrough({
    taskId, pageNum, targetLang, sourceText, targetText, charMap,
    cacheDir, cacheHtml, sourcePng, pageW, pageH, t0, key,
  })
  inflightRenders.set(key, renderPromise)
  try {
    return await renderPromise
  } finally {
    inflightRenders.delete(key)
  }
}

/** passthrough 实际渲染：复用源 PNG + 从源 PDF 提 runs → v6 text-layer */
async function doRenderPassthrough({ taskId, pageNum, targetLang, sourceText, targetText, charMap, cacheDir, cacheHtml, sourcePng, pageW, pageH, t0, key }) {
  fs.mkdirSync(cacheDir, { recursive: true })

  // 1. 从源 PDF 提 runs（task.previewPath 是 soffice 转出来的 PDF）
  let runs = []
  let pdfiumMs = 0
  const task = getTask(taskId)
  const sourcePdf = task?.previewPath
  if (sourcePdf && fs.existsSync(sourcePdf)) {
    try {
      const tExtract = Date.now()
      const result = await pdfiumExtractTextRuns(sourcePdf, pageNum - 1, 120)
      runs = result.runs
      pdfiumMs = Date.now() - tExtract
    } catch (e) {
      console.warn(`[translate-render] passthrough pdfium extract failed for ${taskId}#${pageNum}: ${e.message}`)
    }
  }

  // 2. fullTgt = targetText（identity 时 = sourceText）
  //    真实翻译接入后：fullTgt 是 fullDoc 译文，globalCharMap 是 fullDoc 全局 charMap
  //    passthrough 模式：每页独立调用，fullTgt = 当前页 targetText，globalCharMap = charMap
  const fullTgt = targetText || sourceText || ''
  const tgtChars = Array.from(fullTgt)

  // 3. globalCharMap：传入则用传入的；否则构造 identity per-char（每字一段）
  let globalCharMap = charMap
  if (!globalCharMap || globalCharMap.length === 0) {
    globalCharMap = tgtChars.map((_, i) => ({
      srcStart: i, srcEnd: i + 1,
      tgtStart: i, tgtEnd: i + 1,
    }))
  }

  // 4. pageSlice：当前页对应 fullTgt 的范围（passthrough 模式：fullTgt = 当前页，所以 [0, fullTgt.length)）
  const pageSlice = { pageCharStart: 0, pageCharEnd: tgtChars.length }

  // 5. 构建 v6 text-layer
  const textHtml = buildFullDocTextLayer(runs, pageW, pageH, fullTgt, globalCharMap, pageSlice)
  fs.writeFileSync(cacheHtml, textHtml, 'utf-8')
  const textMs = Date.now() - t0

  const result = {
    imagePath: sourcePng,
    textPath: cacheHtml,
    pageW,
    pageH,
    ms: Date.now() - t0,
  }
  memSet(key, result)
  console.info(`[translate-render] passthrough ok ${key} ${pageW}x${pageH} pdfium=${pdfiumMs}ms text=${textMs}ms total=${result.ms}ms`)
  return { ...result, cached: false, lookupMs: 0 }
}

/**
 * 渲染 synthetic 页面（txt/md 走 v3.1 管线：合成 A4 HTML → soffice → PDFium）
 */
async function renderSyntheticPage({ taskId, pageNum, sourceText, targetLang, targetText, charMap }) {
  const t0 = Date.now()
  const key = `synthetic:${taskId}:${pageNum}:${targetLang}`
  // 1. 内存缓存
  const mc = memGet(key)
  if (mc) {
    console.info(`[translate-render] mem-hit ${key} (${mc.ms}ms cached, +${Date.now() - t0}ms lookup)`)
    return { ...mc, cached: true, ms: mc.ms, lookupMs: Date.now() - t0 }
  }

  // 2. 磁盘缓存
  const cacheDir = path.join(CACHE_ROOT, taskId, targetLang)
  const cachePng = path.join(cacheDir, `page-${String(pageNum).padStart(3, '0')}.png`)
  const cacheHtml = path.join(cacheDir, `page-${String(pageNum).padStart(3, '0')}.html`)
  if (fs.existsSync(cachePng) && fs.existsSync(cacheHtml)) {
    const dim = await imageDimensions(cachePng)
    const result = {
      imagePath: cachePng,
      textPath: cacheHtml,
      pageW: dim.width,
      pageH: dim.height,
      ms: 0,
    }
    memSet(key, result)
    console.info(`[translate-render] disk-hit ${key} ${result.pageW}x${result.pageH} (${Date.now() - t0}ms lookup)`)
    return { ...result, cached: true, ms: 0, lookupMs: Date.now() - t0 }
  }

  // 3. 并发去重：同 key 已有 in-flight 渲染时，直接 await 同一个 promise
  if (inflightRenders.has(key)) {
    console.info(`[translate-render] inflight-dedupe ${key} (${Date.now() - t0}ms wait)`)
    const result = await inflightRenders.get(key)
    return { ...result, cached: false, ms: result.ms, lookupMs: Date.now() - t0 }
  }

  // 4. 渲染管线
  const renderPromise = doRender({ taskId, pageNum, targetLang, sourceText, targetText, charMap, cacheDir, cachePng, cacheHtml, t0, key })
  inflightRenders.set(key, renderPromise)
  try {
    return await renderPromise
  } finally {
    inflightRenders.delete(key)
  }
}

/** 实际执行渲染（被并发锁保护） */
async function doRender({ taskId, pageNum, targetLang, sourceText, targetText, charMap, cacheDir, cachePng, cacheHtml, t0, key }) {
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.mkdirSync(TMP_ROOT, { recursive: true })

  // 3a. 写临时 HTML
  const tmpHtml = path.join(TMP_ROOT, `${taskId}-${pageNum}-${crypto.randomBytes(4).toString('hex')}.html`)
  // 优先用 targetText（已翻译）；否则用 sourceText（占位 — 但正常流程下应该都有）
  const renderText = targetText || sourceText || ''
  fs.writeFileSync(tmpHtml, buildTranslatedHtml(renderText, targetLang), 'utf-8')

  let pdfPath = null
  try {
    // 3b. soffice → PDF
    pdfPath = await convertWithSoffice(tmpHtml, { name: path.basename(tmpHtml) })
    const convertMs = Date.now() - t0
    console.info(`[translate-render] soffice → PDF ${key} (${convertMs}ms)`)

    // 3c. PDFium 渲染 page 1 → PNG（150 dpi 中等清晰度）
    const DPI = 150
    await rasterizeThumb(pdfPath, cachePng, DPI)
    const rasterMs = Date.now() - t0

    // 3d. PDFium 提取 runs + 自建字符级 text-layer（带 data-tgt-idx / data-src-idx）
    const { runs, pageWidthPx, pageHeightPx } = await pdfiumExtractTextRuns(pdfPath, 0, DPI)
    const textHtml = buildTextLayerWithCharMap(runs, pageWidthPx, pageHeightPx, renderText, charMap || [])
    fs.writeFileSync(cacheHtml, textHtml, 'utf-8')
    const textMs = Date.now() - t0

    const dim = await imageDimensions(cachePng)
    const ms = Date.now() - t0
    const result = {
      imagePath: cachePng,
      textPath: cacheHtml,
      pageW: dim.width,
      pageH: dim.height,
      ms,
    }
    memSet(key, result)
    console.info(`[translate-render] ok ${key} ${result.pageW}x${result.pageH} convert=${convertMs}ms raster=${rasterMs}ms text=${textMs}ms total=${ms}ms`)
    return { ...result, cached: false, lookupMs: 0 }
  } finally {
    // 3e. 清理临时文件
    try { fs.unlinkSync(tmpHtml) } catch {}
    if (pdfPath) {
      try { fs.unlinkSync(pdfPath) } catch {}
    }
  }
}

/**
 * 批量预渲染多页（用于预热 + 进度条场景）
 * @param {Array<{ taskId: string, pageNum: number, sourceText: string, targetLang: string, targetText?: string }>} pages
 * @param {(p: { pageNum: number, ok: boolean, error?: string }) => void} onProgress
 */
export async function renderTranslatedPages(pages, onProgress) {
  const results = []
  for (const p of pages) {
    try {
      const r = await renderTranslatedPage(p)
      results.push({ ...p, ...r, ok: true })
      onProgress?.({ pageNum: p.pageNum, ok: true })
    } catch (e) {
      results.push({ ...p, ok: false, error: e.message })
      onProgress?.({ pageNum: p.pageNum, ok: false, error: e.message })
    }
  }
  return results
}

/**
 * 测试辅助：清空内存缓存 + 并发锁。
 * 注意：不会清理磁盘缓存（`.data/translate-render-cache/`），需要测试自行 rm。
 */
export function __resetTranslateRenderCache() {
  memCache.clear()
  inflightRenders.clear()
}
