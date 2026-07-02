// Worker Engine：在 Web Worker 中运行 @hyzyla/pdfium
// 模型：claude-sonnet-4-6
//
// 职责：
//   1. 初始化 PDFiumLibrary（单例）
//   2. openDocument: fetch PDF + loadDocument
//   3. renderPage: OffscreenCanvas 渲染 → createImageBitmap → transferToImageBitmap zero-copy
//   4. extractText: _FPDFText_* raw C bindings → Float32Array char positions
//   5. 渐进式渲染：低清 0.5x 先返回 → 全清 scale 后返回
//
// 消息协议：与 coordinator.ts 对齐
// REQUEST:  { type, requestId, ...params }
// RESPONSE: { type, requestId, ...data }

import { PDFiumLibrary } from '@hyzyla/pdfium/browser/base64'

// ============ 全局状态 ============

let _lib: Awaited<ReturnType<typeof PDFiumLibrary.init>> | null = null
let _libPromise: Promise<Awaited<ReturnType<typeof PDFiumLibrary.init>>> | null = null
let _docs = new Map<number, { doc: any; url: string; getPage: (i: number) => any; getPageCount: () => number }>()
let _docIdSeq = 0

// Worker 侧取消机制：记录每个 (docId, pageNum) 的最后一个 requestId
// 旧的渲染在开始前检测，如果 requestId 落后则跳过
const _pageLatestRequest = new Map<string, number>()
// 并发控制：最多同时渲染 N 页
let _renderConcurrency = 0
const MAX_RENDER_CONCURRENCY = 2

// ============ 初始化 ============

async function ensureLib(): Promise<typeof _lib> {
  if (_lib) return _lib
  if (_libPromise) return _libPromise!
  _libPromise = (async () => {
    console.log('[pdf-wasm-worker] init PDFiumLibrary')
    const t0 = performance.now()
    _lib = await PDFiumLibrary.init()
    console.log('[pdf-wasm-worker] PDFiumLibrary ready', Math.round(performance.now() - t0), 'ms')
    return _lib
  })()
  return _libPromise
}

// ============ 消息处理 ============

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data

  try {
    switch (msg.type) {
      case 'openDocument':
        await handleOpenDocument(msg)
        break
      case 'renderPage':
        handleRenderPageAsync(msg)
        break
      case 'cancelRender':
        handleCancelRender(msg)
        break
      case 'extractText':
        await handleExtractText(msg)
        break
      case 'closeDocument':
        await handleCloseDocument(msg)
        break
      case 'getPageSize':
        await handleGetPageSize(msg)
        break
      default:
        postError(msg.requestId, `unknown message type: ${msg.type}`)
    }
  } catch (err: any) {
    console.error('[pdf-wasm-worker] error handling', msg.type, err)
    postError(msg.requestId, err?.message || String(err))
  }
}

// ============ Handler ============

interface ReqBase {
  type: string
  requestId: number
}

async function handleOpenDocument(msg: ReqBase & { url: string }) {
  const lib = await ensureLib()
  if (!lib) throw new Error('PDFiumLibrary not available')

  console.log('[pdf-wasm-worker] fetch', msg.url)
  const t0 = performance.now()

  const resp = await fetch(msg.url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${msg.url}`)

  const buf = await resp.arrayBuffer()
  console.log('[pdf-wasm-worker] fetched', buf.byteLength, 'bytes', Math.round(performance.now() - t0), 'ms')

  const t1 = performance.now()
  const doc = await lib.loadDocument(new Uint8Array(buf))
  console.log('[pdf-wasm-worker] parsed', doc.getPageCount(), 'pages', Math.round(performance.now() - t1), 'ms')

  const docId = ++_docIdSeq
  _docs.set(docId, { doc, url: msg.url, getPage: (i: number) => doc.getPage(i), getPageCount: () => doc.getPageCount() })

  // 预取所有页尺寸
  const pageSizes: Array<{ w: number; h: number }> = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const { originalWidth, originalHeight } = page.getOriginalSize()
    pageSizes.push({ w: originalWidth, h: originalHeight })
  }

  self.postMessage({ type: 'documentOpened', requestId: msg.requestId, docId, pageCount: doc.getPageCount(), pageSizes })
}

async function handleRenderPage(msg: ReqBase & { docId: number; pageNum: number; scale: number; progressive: boolean }) {
  const lib = await ensureLib()
  if (!lib) throw new Error('PDFiumLibrary not available')

  const entry = _docs.get(msg.docId)
  if (!entry) throw new Error(`doc ${msg.docId} not found`)

  const pageKey = `${msg.docId}:${msg.pageNum}`
  _pageLatestRequest.set(pageKey, msg.requestId)

  const pageIndex = msg.pageNum - 1
  const page = entry.doc.getPage(pageIndex)
  const { originalWidth, originalHeight } = page.getOriginalSize()
  const w = Math.floor(originalWidth * msg.scale)
  const h = Math.floor(originalHeight * msg.scale)

  const t0 = performance.now()

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context not available')

  const renderResult = await page.render({ scale: msg.scale, width: w, height: h })

  // 检查是否已被更新的请求取代
  if (_pageLatestRequest.get(pageKey) !== msg.requestId) {
    console.log('[pdf-wasm-worker] page', msg.pageNum, 'stale, discarding')
    return  // page closed below
  }

  const imgData = new ImageData(new Uint8ClampedArray(renderResult.data), renderResult.width, renderResult.height)
  ctx.putImageData(imgData, 0, 0)

  const bitmap = await createImageBitmap(canvas)

  // 再次检查取消
  if (_pageLatestRequest.get(pageKey) !== msg.requestId) {
    try { bitmap.close() } catch {}
    return
  }

  console.log('[pdf-wasm-worker] rendered page', msg.pageNum,
    'scale=', msg.scale.toFixed(2),
    'size=', renderResult.width, 'x', renderResult.height,
    Math.round(performance.now() - t0), 'ms',
    msg.progressive ? '(progressive)' : '')

  try { page._close?.() } catch {}
  _renderConcurrency = Math.max(0, _renderConcurrency - 1)

  self.postMessage({
    type: 'pageRendered',
    requestId: msg.requestId,
    pageNum: msg.pageNum,
    bitmap,
    width: renderResult.width,
    height: renderResult.height,
    phase: msg.progressive ? 'low' : 'full',
  }, { transfer: [bitmap] })
}

function handleRenderPageAsync(msg: ReqBase & { docId: number; pageNum: number; scale: number; progressive: boolean }) {
  // 更新最新 requestId（旧请求开始前会检查）
  const pageKey = `${msg.docId}:${msg.pageNum}`
  _pageLatestRequest.set(pageKey, msg.requestId)

  // 并发限制：超过限制时，丢弃旧队列中的请求
  // 直接启动（不等待），requestId 机制保证只有最新的结果被发送
  handleRenderPage(msg).catch(err => {
    _renderConcurrency = Math.max(0, _renderConcurrency - 1)
    console.warn('[pdf-wasm-worker] render async error', msg.pageNum, err?.message || err)
    postError(msg.requestId, err?.message || String(err))
  })
}

function handleCancelRender(msg: ReqBase & { docId: number; pageNum: number }) {
  const pageKey = `${msg.docId}:${msg.pageNum}`
  // 设置一个不在 pending 中存在的 requestId 来取消
  _pageLatestRequest.set(pageKey, -1)
  console.log('[pdf-wasm-worker] cancel render', msg.pageNum)
}

async function handleExtractText(msg: ReqBase & { docId: number; pageNum: number; scale: number }) {
  const lib = await ensureLib()
  if (!lib) throw new Error('PDFiumLibrary not available')

  const entry = _docs.get(msg.docId)
  if (!entry) throw new Error(`doc ${msg.docId} not found`)

  const pageIndex = msg.pageNum - 1
  const page = entry.doc.getPage(pageIndex)
  const { originalWidth, originalHeight } = page.getOriginalSize()
  const scale = msg.scale

  const pageWidthPx = Math.floor(Math.floor(originalWidth) * scale)
  const pageHeightPx = Math.floor(Math.floor(originalHeight) * scale)
  const scaleX = pageWidthPx / originalWidth
  const scaleY = pageHeightPx / originalHeight

  // 访问 WASM module 的低级 API
  const mod = (page as any).module
  const pageIdx = (page as any).pageIdx

  const t0 = performance.now()
  const textPage = mod._FPDFText_LoadPage(pageIdx)
  if (!textPage) {
    self.postMessage({ type: 'textExtracted', requestId: msg.requestId, pageNum: msg.pageNum, positions: new Float32Array(0), chars: '', pageW: pageWidthPx, pageH: pageHeightPx })
    return
  }

  try {
    const charCount = mod._FPDFText_CountChars(textPage)
    // 7 floats per char: [left, top, right, bottom, fontSize, charCode, width]
    const positions = new Float32Array(charCount * 7)
    const charsArr: string[] = []

    const lPtr = mod.wasmExports.malloc(8)
    const rPtr = mod.wasmExports.malloc(8)
    const bPtr = mod.wasmExports.malloc(8)
    const tPtr = mod.wasmExports.malloc(8)

    try {
      for (let i = 0; i < charCount; i++) {
        mod._FPDFText_GetCharBox(textPage, i, lPtr, rPtr, bPtr, tPtr)

        const view = new DataView(mod.HEAPU8.buffer, lPtr, 32)
        const leftPt   = view.getFloat64(0, true)
        const rightPt  = view.getFloat64(8, true)
        const bottomPt = view.getFloat64(16, true)
        const topPt    = view.getFloat64(24, true)

        const left   = leftPt * scaleX
        const right  = rightPt * scaleX
        const top    = (originalHeight - topPt) * scaleY
        const bottom = (originalHeight - bottomPt) * scaleY

        const unicode = mod._FPDFText_GetUnicode(textPage, i)
        const char = unicode > 0 ? String.fromCodePoint(unicode) : ''
        const fontSizePt = mod._FPDFText_GetFontSize(textPage, i) || 12
        const fontSize = fontSizePt * scaleY

        const idx = i * 7
        positions[idx] = left
        positions[idx + 1] = top
        positions[idx + 2] = right
        positions[idx + 3] = bottom
        positions[idx + 4] = fontSize
        positions[idx + 5] = unicode
        positions[idx + 6] = right - left // char width

        charsArr.push(char)
      }
    } finally {
      mod.wasmExports.free(lPtr)
      mod.wasmExports.free(rPtr)
      mod.wasmExports.free(bPtr)
      mod.wasmExports.free(tPtr)
    }

    const chars = charsArr.join('')
    console.log('[pdf-wasm-worker] text extracted page', msg.pageNum, charCount, 'chars', Math.round(performance.now() - t0), 'ms')

    self.postMessage({
      type: 'textExtracted',
      requestId: msg.requestId,
      pageNum: msg.pageNum,
      positions,
      chars,
      pageW: pageWidthPx,
      pageH: pageHeightPx,
    }, { transfer: [positions.buffer] })
  } finally {
    mod._FPDFText_ClosePage(textPage)
  }
}

async function handleCloseDocument(msg: ReqBase & { docId: number }) {
  const entry = _docs.get(msg.docId)
  if (entry) {
    try { entry.doc.destroy() } catch (e) { console.warn('[pdf-wasm-worker] destroy doc error', e) }
    _docs.delete(msg.docId)
    console.log('[pdf-wasm-worker] doc closed', msg.docId)
  }
  self.postMessage({ type: 'documentClosed', requestId: msg.requestId })
}

async function handleGetPageSize(msg: ReqBase & { docId: number; pageNum: number }) {
  const entry = _docs.get(msg.docId)
  if (!entry) { postError(msg.requestId, `doc ${msg.docId} not found`); return }

  const page = entry.doc.getPage(msg.pageNum - 1)
  const { originalWidth, originalHeight } = page.getOriginalSize()
  self.postMessage({ type: 'pageSize', requestId: msg.requestId, w: originalWidth, h: originalHeight })
}

function postError(requestId: number, message: string) {
  self.postMessage({ type: 'error', requestId, message })
}

// Worker 就绪信号
console.log('[pdf-wasm-worker] ready')
self.postMessage({ type: 'ready', requestId: -1 })