// PDFium C++ 统一渲染管线（服务端 Node）
// 模型：Claude MiniMax-M3（MiniMax）
// 通过 @hyzyla/pdfium（WASM-compiled PDFium C++）实现：
//   - renderPageToPng  : 单页 → PNG Buffer
//   - extractCharBoxes : 单页 → 字符级 bbox（与 PNG 同源，100% 像素匹配）
// 关键：renderPageToPng 与 extractCharBoxes 共享同一 FPDF_DOCUMENT / FPDF_PAGE 句柄
//       → 字符 bbox 中心必落在 PNG dark ink 像素上（消除 pdftoppm+pdftotext 跨引擎漂移）
// Fallback：@hyzyla/pdfium init 失败 → 自动回退 pdftoppm/pdftotext（保持旧链路工作）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'

// ============ 可观测 ============
const _metrics = {
  initMs: 0,
  docsOpen: 0,
  cacheHit: 0,
  cacheMiss: 0,
  renderMs: 0,
  renderCount: 0,
  textMs: 0,
  textCount: 0,
  fallbackRenderCount: 0,
  fallbackTextCount: 0,
  lastError: null
}
export function getPdfiumMetrics() {
  return { ..._metrics, engine: _engine, engineVersion: _engineVersion, available: _engineAvailable }
}
export function resetPdfiumMetrics() { for (const k of Object.keys(_metrics)) _metrics[k] = 0 }

function log(tag, msg) { console.log(`[pdfium] ${msg}`) }
function warn(tag, msg) { console.warn(`[pdfium] ${msg}`) }

// ============ 引擎状态 ============
let _engine = 'uninitialized' // 'pdfium' | 'fallback-poppler' | 'failed'
let _engineVersion = null
let _engineAvailable = false
let _lib = null
let _libPromise = null

async function tryInit() {
  if (_engineAvailable) return true
  if (_engine === 'failed') return false
  const t0 = Date.now()
  try {
    const mod = await import('@hyzyla/pdfium')
    console.log('[pdfium] imported mod keys:', Object.keys(mod))
    const lib = await mod.PDFiumLibrary.init()
    _lib = lib
    _engine = 'pdfium'
    _engineVersion = '2.1.13'
    _engineAvailable = true
    _metrics.initMs = Date.now() - t0
    log('init', `engine=${_engine} version=${_engineVersion} initMs=${_metrics.initMs}`)
    return true
  } catch (e) {
    _engine = 'failed'
    _metrics.lastError = e.message
    warn('init', `PDFium init FAILED → fallback to poppler: ${e.message}`)
    return false
  }
}

async function getLib() {
  if (_engineAvailable) return _lib
  if (_libPromise) return _libPromise
  _libPromise = tryInit().then(ok => ok ? _lib : null)
  return _libPromise
}

// ============ LRU 文档缓存 ============
class DocLRU {
  constructor(maxDocs = 5, idleMs = 30_000) {
    this.max = maxDocs
    this.idleMs = idleMs
    this.map = new Map() // path → { lib, doc, docIdx, buffer, size, lastUsed, refCount }
    this.sweeper = null
  }
  _touch(entry) { entry.lastUsed = Date.now(); this.map.delete(entry.path); this.map.set(entry.path, entry) }
  async get(filePath) {
    const lib = await getLib(); if (!lib) return null
    const e = this.map.get(filePath)
    if (e) { this._touch(e); _metrics.cacheHit++; return e }
    // miss: load
    if (!fs.existsSync(filePath)) return null
    const buf = fs.readFileSync(filePath)
    const size = buf.length
    if (this.map.size >= this.max) {
      // evict LRU
      let oldestKey = null, oldestTime = Infinity
      for (const [k, v] of this.map) { if (v.lastUsed < oldestTime) { oldestTime = v.lastUsed; oldestKey = k } }
      if (oldestKey) { this._destroy(this.map.get(oldestKey)); this.map.delete(oldestKey) }
    }
    const t0 = Date.now()
    const doc = await lib.loadDocument(new Uint8Array(buf))
    const entry = { path: filePath, lib, doc, buffer: buf, size, lastUsed: Date.now(), refCount: 0 }
    this.map.set(filePath, entry)
    _metrics.docsOpen = this.map.size
    _metrics.cacheMiss++
    log('open', `${path.basename(filePath)} pages=${doc.getPageCount()} ${Date.now()-t0}ms`)
    this._startSweeper()
    return entry
  }
  _startSweeper() {
    if (this.sweeper) return
    this.sweeper = setInterval(() => {
      const now = Date.now()
      for (const [k, v] of this.map) {
        if (v.refCount === 0 && now - v.lastUsed > this.idleMs) {
          this._destroy(v); this.map.delete(k)
          log('evict', `${path.basename(k)} idle=${Math.round((now - v.lastUsed)/1000)}s`)
        }
      }
      _metrics.docsOpen = this.map.size
      if (this.map.size === 0 && this.sweeper) { clearInterval(this.sweeper); this.sweeper = null }
    }, 5_000)
    if (this.sweeper.unref) this.sweeper.unref()
  }
  _destroy(entry) {
    try { entry.doc.destroy() } catch {}
  }
  destroy() {
    for (const v of this.map.values()) this._destroy(v)
    this.map.clear(); if (this.sweeper) clearInterval(this.sweeper)
  }
}
const _lru = new DocLRU(Number(process.env.PDFIUM_CACHE_MAX_DOCS || 5), Number(process.env.PDFIUM_CACHE_IDLE_MS || 30000))

// ============ 最小 PNG 编码器（RGBA 8bit，无交错，filter=None）============
// 不依赖 sharp/canvas/pngjs，~80 行。够 server 端 page/text 渲染用。
function crc32(buf) {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

// ============ 公开 API ============
export async function pdfiumGetPageCount(filePath) {
  if (!fs.existsSync(filePath)) return 0
  await getLib()
  if (_engineAvailable) {
    const e = await _lru.get(filePath); if (!e) return 0
    return e.doc.getPageCount()
  }
  // fallback: poppler pdfinfo
  return new Promise(resolve => {
    const c = spawn('/opt/homebrew/bin/pdfinfo', [filePath])
    let out = ''
    c.stdout.on('data', d => { out += d.toString() })
    c.on('close', () => {
      const m = out.match(/^Pages:\s+(\d+)/m)
      resolve(m ? Number(m[1]) : 0)
    })
    c.on('error', () => resolve(0))
  })
}

/** 单页 PNG 渲染（pageIdx 是 0-based） */
export async function pdfiumRenderPageToPng(filePath, pageIdx, dpi = 120) {
  // 关键：先尝试 init（如果是首次调用）
  await getLib()
  if (_engineAvailable) {
    const e = await _lru.get(filePath); if (!e) throw new Error(`pdfiumRenderPageToPng: cannot open ${filePath}`)
    const page = e.doc.getPage(pageIdx)
    const t0 = Date.now()
    const scale = dpi / 72
    // 默认 'bitmap' 模式 → 返回 raw BGRA Uint8Array（最快）
    const image = await page.render({ scale, render: 'bitmap' })
    const tRender = Date.now() - t0
    // BGRA → PNG（在 render 之后做，避免 callback 阻塞 WASM 释放）
    const t1 = Date.now()
    const png = bgraToPng(image.data, image.width, image.height)
    _metrics.renderMs += Date.now() - t0
    _metrics.renderCount++
    return png
  }
  // fallback: pdftoppm
  _metrics.fallbackRenderCount++
  return new Promise((resolve, reject) => {
    const tmpBase = path.join(os.tmpdir(), `pdfium-fb-${process.pid}-${Date.now()}-${pageIdx}`)
    const c = spawn('/opt/homebrew/bin/pdftoppm', ['-png', '-r', String(dpi), '-f', String(pageIdx+1), '-l', String(pageIdx+1), filePath, tmpBase])
    c.on('close', code => {
      if (code !== 0) return reject(new Error(`pdftoppm fallback exited ${code}`))
      // pdftoppm 输出 `${tmpBase}-${pageIdx+1}.png`（1-based）
      const out = `${tmpBase}-${pageIdx + 1}.png`
      try { resolve(fs.readFileSync(out)) } catch (e) { reject(e) }
    })
    c.on('error', reject)
  })
}

/** 内部：BGRA → PNG Buffer（同步，最快路径） */
function bgraToPng(bgra, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter=None
    const srcOff = y * stride
    const dstOff = y * (stride + 1) + 1
    for (let x = 0; x < width; x++) {
      raw[dstOff + x*4 + 0] = bgra[srcOff + x*4 + 2] // R ← B
      raw[dstOff + x*4 + 1] = bgra[srcOff + x*4 + 1] // G
      raw[dstOff + x*4 + 2] = bgra[srcOff + x*4 + 0] // B ← R
      raw[dstOff + x*4 + 3] = bgra[srcOff + x*4 + 3] // A
    }
  }
  const idat = zlib.deflateSync(raw, { level: 6 })
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** 单页字符 bbox 提取（pageIdx 0-based；返回 screen coords，即 PNG 像素空间） */
export async function pdfiumExtractCharBoxes(filePath, pageIdx, dpi = 120) {
  await getLib()
  if (_engineAvailable) {
    const e = await _lru.get(filePath); if (!e) return { boxes: [], pageWidthPx: 0, pageHeightPx: 0, source: 'pdfium' }
    const page = e.doc.getPage(pageIdx)
    const mod = e.lib.module // 私有 module 通过 TS-ignore 安全访问
    const size = page.getOriginalSize()
    const scale = dpi / 72
    // 关键：PDFium render 的实际像素尺寸 ≠ Math.round(orig * scale)。
    // 实测：originalSize=595.3×841.95, scale=1.6667 → PDFium render 返回 991×1401
    // 而 Math.round(595.3*1.6667)=992。偏差 1-2px 导致 span 坐标系与 PNG 像素空间不一致。
    // PDFium 内部公式：floor(floor(orig) * scale)（先截断为整数点，再缩放取整）
    // 用 effectiveScale = pageWidthPx / originalWidth 确保坐标 100% 落在 PNG 像素上
    const pageWidthPx = Math.floor(Math.floor(size.originalWidth) * scale)
    const pageHeightPx = Math.floor(Math.floor(size.originalHeight) * scale)
    const scaleX = pageWidthPx / size.originalWidth
    const scaleY = pageHeightPx / size.originalHeight
    const t0 = Date.now()
    const textPage = mod._FPDFText_LoadPage(page.pageIdx)
    if (!textPage) return { boxes: [], pageWidthPx, pageHeightPx, source: 'pdfium' }
    try {
      const count = mod._FPDFText_CountChars(textPage)
      const boxes = []
      // 复用 4 个 double 指针
      const lPtr = mod.wasmExports.malloc(8)
      const rPtr = mod.wasmExports.malloc(8)
      const bPtr = mod.wasmExports.malloc(8)
      const tPtr = mod.wasmExports.malloc(8)
      try {
        for (let i = 0; i < count; i++) {
          mod._FPDFText_GetCharBox(textPage, i, lPtr, rPtr, bPtr, tPtr)
          const leftPt   = mod.HEAPF64[lPtr >> 3]
          const rightPt  = mod.HEAPF64[rPtr >> 3]
          const bottomPt = mod.HEAPF64[bPtr >> 3] // PDF Y-up
          const topPt    = mod.HEAPF64[tPtr >> 3]
          // PDF 坐标系：(leftPt, bottomPt, rightPt, topPt)，Y 向上
          // 屏幕坐标系：(leftPx, topPx, rightPx, bottomPx)，Y 向下
          // 用 effectiveScale (非 uniform) 确保坐标落在 PDFium 实际 render 的像素空间
          const left   = leftPt * scaleX
          const right  = rightPt * scaleX
          const top    = (size.originalHeight - topPt) * scaleY
          const bottom = (size.originalHeight - bottomPt) * scaleY
          const unicode = mod._FPDFText_GetUnicode(textPage, i)
          const char = unicode > 0 ? String.fromCodePoint(unicode) : ''
          // 字体大小（PDFium WASM 返回 PDF points，需缩放到屏幕像素以匹配 PNG 渲染）
          const fontSizePt = mod._FPDFText_GetFontSize(textPage, i) || 12
          const fontSize = fontSizePt * scaleY
          boxes.push({ char, left, top, right, bottom, unicode, fontSize, baselineY: bottom })
        }
      } finally {
        mod.wasmExports.free(lPtr); mod.wasmExports.free(rPtr); mod.wasmExports.free(bPtr); mod.wasmExports.free(tPtr)
      }
      _metrics.textMs += Date.now() - t0
      _metrics.textCount++
      return { boxes, pageWidthPx, pageHeightPx, source: 'pdfium' }
    } finally {
      mod._FPDFText_ClosePage(textPage)
    }
  }
  // fallback: 空 boxes（前端 text layer 兜底）
  _metrics.fallbackTextCount++
  return { boxes: [], pageWidthPx: 0, pageHeightPx: 0, source: 'fallback' }
}

/**
 * 单页 text runs 提取（PDF.js 行业标杆 — run-level 渲染）
 * 把 char-level boxes 按 (fontSize, baselineY) 分组到 runs：
 *   同一行 + 同字体的连续字符 = 1 个 run → 1 个 <span>
 * 浏览器按 font-size + line-height:1 自动 baseline 对齐（解决 bullet ● 和汉字错位）
 *
 * 关键：对齐公式来自 PDF.js
 *   top = baselineY - fontSize × ASCENT_RATIO  （CSS top 在 span 容器）
 *   font-size = fontSize px
 *   line-height: 1;  transform-origin: 0 0;  white-space: pre
 */
const RUN_ASCENT_RATIO = 0.80   // CJK + Latin 混合的经验值（PDF.js 用 0.75~0.88 表）
const RUN_LINE_TOLERANCE = 0.5  // PDF.js: 同一行的 baselineY 容差 = 0.5 × fontSize
export async function pdfiumExtractTextRuns(filePath, pageIdx, dpi = 120) {
  const { boxes, pageWidthPx, pageHeightPx } = await pdfiumExtractCharBoxes(filePath, pageIdx, dpi)
  if (!boxes.length) return { runs: [], pageWidthPx, pageHeightPx, source: 'pdfium' }
  const runs = []
  let cur = null
  for (const b of boxes) {
    if (!b.char) continue
    // 过滤幽灵字符：fontSize 极小（< 3px）或不可见控制字符（换行、回车等）
    // 这类字符来自 PDF 内嵌的控制码，选区无法命中，会形成 0.5×0.5 幽灵 span
    if (b.fontSize < 3) continue
    const cp = b.char.codePointAt(0)
    if (cp !== undefined && (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F))) continue
    // 纯空白字符（unicode === 32）作为字间距：附加到当前 run（white-space: pre 保留）
    const isSpace = b.char === ' '
    const sameFont = cur && Math.abs(b.fontSize - cur.fontSize) < 0.5
    const sameLine = cur && Math.abs(b.baselineY - cur.baselineY) < Math.max(b.fontSize, cur.fontSize) * RUN_LINE_TOLERANCE
    if (cur && sameFont && sameLine) {
      cur.str += b.char
      cur.left = Math.min(cur.left, b.left)
      cur.right = Math.max(cur.right, b.right)
      cur.top = Math.min(cur.top, b.top)
      cur.bottom = Math.max(cur.bottom, b.bottom)
      cur.baselineY = (cur.baselineY + b.baselineY) / 2
    } else {
      if (cur) runs.push(cur)
      cur = {
        str: b.char,
        fontSize: b.fontSize,
        baselineY: b.baselineY,
        left: b.left,
        right: b.right,
        top: b.top,
        bottom: b.bottom
      }
    }
  }
  if (cur) runs.push(cur)
  return { runs, pageWidthPx, pageHeightPx, source: 'pdfium' }
}

/** 批量渲染所有页（返回 [{page, file, width, height}]，page 1-based） */
export async function pdfiumRenderAllPages(filePath, outDir, prefix = 'page', dpi = 120, parallel = 1, onProgress = null) {
  fs.mkdirSync(outDir, { recursive: true })
  const total = await pdfiumGetPageCount(filePath)
  if (total <= 0) return []
  const perBucket = Math.max(1, Math.ceil(total / parallel))
  const buckets = []
  for (let from = 1; from <= total; from += perBucket) {
    buckets.push({ from, to: Math.min(from + perBucket - 1, total) })
  }
  const all = []
  let done = 0
  await Promise.all(buckets.map(async b => {
    for (let p = b.from; p <= b.to; p++) {
      const pad3 = String(p).padStart(3, '0')
      const outPath = path.join(outDir, `${prefix}-${pad3}.png`)
      const buf = await pdfiumRenderPageToPng(filePath, p - 1, dpi)
      fs.writeFileSync(outPath, buf)
      // 解析 PNG IHDR 取真实像素
      const w = buf.readUInt32BE(16); const h = buf.readUInt32BE(20)
      all.push({ page: p, file: outPath, width: w, height: h })
      done++
      if (onProgress) onProgress(done)
    }
  }))
  all.sort((a, b) => a.page - b.page)
  return all
}

export function destroyPdfium() {
  _lru.destroy()
  if (_lib) { try { _lib.destroy() } catch {} ; _lib = null }
  _engineAvailable = false
}
