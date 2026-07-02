import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadPdfjs, PDFJS_CMAP_URL, PDFJS_STD_FONTS_URL } from '../../renderers/pdf/pdfjsLoader'
import { loadDocumentInWorker, renderPageWithMupdf, unloadDocumentFromWorker, disposeMupdfWorker } from '../../renderers/pdf/mupdfLoader'
import { PageLRU } from '../../renderers/pdf/pageLRU'
import { BitmapCache } from '../../renderers/pdf/bitmapCache'
import { RenderQueue } from '../../renderers/pdf/renderQueue'
import { scheduleIdleTask, schedulePrefetch } from '../../renderers/pdf/idleScheduler'
import { planTextLayer } from '../../renderers/pdf/textLayerPlan'
import { WasmCleanupScheduler } from '../../renderers/pdf/wasmCleanup'

// ============================================================================
// PdfViewer — 纯 PDF 渲染组件（pdf.js canvas + 文字层）
//   接收 pdfUrl，不涉及任何 Office → PDF 转换逻辑。
//   功能：首屏即时渲染、页面导航、scroll-spy、键盘快捷键、
//         文字搜索、下载、Ctrl+滚轮缩放、骨架屏、逐屏渲染耗时监控
// ============================================================================

type Phase = 'idle' | 'loading' | 'ready' | 'error'

interface PageSize {
  width: number
  height: number
}

export interface PageTiming {
  page: number
  getPageMs: number
  render1xMs: number
  render2xMs: number
  textLayerMs: number
  totalMs: number
}

export function PdfViewer({ pdfUrl, downloadName, onBack, label, showLoadModeToggle, forcedLoadMode, showTiming }: {
  pdfUrl: string
  downloadName?: string
  onBack?: () => void
  label?: string
  showLoadModeToggle?: boolean
  forcedLoadMode?: 'range' | 'full'
  showTiming?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageSizes, setPageSizes] = useState<PageSize[]>([])
  const [scale, setScale] = useState(1.0)
  const [currentPage, setCurrentPage] = useState(1)
  const [_loadMode, setLoadMode] = useState<'range' | 'full'>('range')
  const loadMode = forcedLoadMode ?? _loadMode
  const [loadStats, setLoadStats] = useState<{ time: number; bytes: number } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([])
  const [activeResultIdx, setActiveResultIdx] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [searching, setSearching] = useState(false)
  const [timings, setTimings] = useState<PageTiming[]>([])

  const pdfDocRef = useRef<any>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const timingsRef = useRef<PageTiming[]>([])

  const onPageTiming = useCallback((t: PageTiming) => {
    // 原做法：两次展开（push+slice）创建两个新数组；改为 push 到 ref，slice 一次给 state。
    timingsRef.current.push(t)
    setTimings(timingsRef.current.slice())
  }, [])

  // ref 存频繁变化的值，避免键盘事件 handler 频繁重新绑定
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  const numPagesRef = useRef(numPages)
  numPagesRef.current = numPages
  const searchResultsRef = useRef(searchResults)
  searchResultsRef.current = searchResults
  const activeResultIdxRef = useRef(activeResultIdx)
  activeResultIdxRef.current = activeResultIdx

  // ── 渲染优化基础设施（懒初始化，per-instance，unmount 时清理） ──
  // RenderQueue: 限制并发渲染数，按 |pageNum-currentPage| 距离排优先级
  // PageLRU: 持有 PDFPageProxy；离开活跃窗口时 cleanup() 释放 worker 内存
  // BitmapCache: 持有 ImageBitmap；离开 LRU 时 close() 释放 GPU 内存
  // mupdf 两阶段：phase=ready 后后台 fetch 完整 PDF → Worker 渲染（~10x 更快）
  const [mupdfActive, setMupdfActive] = useState(false)
  const mupdfActiveRef = useRef(false)
  // full 模式下 pdf.js 已拉取 buffer，复用给 mupdf 避免二次下载
  const mupdfBufferRef = useRef<ArrayBuffer | null>(null)

  const renderQueueRef = useRef<RenderQueue | null>(null)
  const pageLRURef = useRef<PageLRU<any> | null>(null)
  const bitmapCacheRef = useRef<BitmapCache<string> | null>(null)
  // WasmCleanupScheduler: 每 10 页渲染后 idle 调 pdfjsLib.cleanup()，
  //   释放 worker 内部 cache（CMap / 字体 / 图像），防止长 PDF 越翻越慢。
  const cleanupSchedulerRef = useRef<WasmCleanupScheduler | null>(null)
  if (!renderQueueRef.current) renderQueueRef.current = new RenderQueue(1)  // 串行：避免多 worker 抢同一文档导致 getPage/render 内部锁争抢
  // rootMargin:1200px 使得一次可有 ~10-15 页同时 intersecting；
  // 容量太小会导致来回滚动时频繁淘汰 + 重渲染（thrashing）。
  if (!pageLRURef.current) pageLRURef.current = new PageLRU(12)          // 5→12
  if (!bitmapCacheRef.current) bitmapCacheRef.current = new BitmapCache<string>(20)  // 6→20
  if (!cleanupSchedulerRef.current) {
    cleanupSchedulerRef.current = new WasmCleanupScheduler({
      intervalMs: 30_000,
      threshold: 10,
      // loadPdfjs() 是幂等的（内部缓存 Promise），已加载时立即返回 resolved 模块。
      // globalThis.pdfjsLib 从未被设置（pdfjs 走 dynamic import），原实现是 no-op。
      cleanup: async () => {
        try {
          const pdfjs = await loadPdfjs()
          pdfjs?.cleanup?.()
        } catch { /* swallow */ }
      },
    })
  }

  // unmount 清理：drain 队列 + cleanup 所有 page + close 所有 bitmap + 取消 cleanup scheduler
  useEffect(() => {
    return () => {
      const q = renderQueueRef.current
      const lru = pageLRURef.current
      const cache = bitmapCacheRef.current
      const cleanupSched = cleanupSchedulerRef.current
      // cancel 所有 pending 任务（PdfPage 的 cleanup 已通过各自 effect cleanup 取消，
      // 但 cancelAll 提供一道保险，防止 React unmount 顺序与预期不一致）
      if (q) {
        q.cancelAll()
      }
      if (lru) lru.clear()
      if (cache) cache.clear()
      cleanupSched?.cancel()
      renderQueueRef.current = null
      pageLRURef.current = null
      bitmapCacheRef.current = null
      cleanupSchedulerRef.current = null
      unloadDocumentFromWorker()
      disposeMupdfWorker()
    }
  }, [])

  // ── PDF 加载（支持 Range 分片 / 全量两种模式） ──
  useEffect(() => {
    let off = false
    setPhase('loading')
    setErr(null)
    setPageSizes([])
    setNumPages(0)
    pdfDocRef.current = null
    setLoadStats(null)
    timingsRef.current = []
    setTimings([])

    const t0 = performance.now()

    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()

        let doc: any
        let totalBytes = 0

        if (loadMode === 'full') {
          // 全量加载：fetch 整个 PDF → ArrayBuffer → pdf.js
          const res = await fetch(pdfUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}: 无法加载 PDF`)
          const buffer = await res.arrayBuffer()
          totalBytes = buffer.byteLength
          // 保留一份给 mupdf Worker，避免后台再次下载（range 模式无此优化）
          mupdfBufferRef.current = buffer.slice(0)
          doc = await pdfjs.getDocument({
            data: buffer.slice(0),
            cMapUrl: PDFJS_CMAP_URL,
            cMapPacked: true,
            standardFontDataUrl: PDFJS_STD_FONTS_URL,
          }).promise
        } else {
          // 分片加载：HEAD 探测 → PDFDataRangeTransport 接管
          // progressiveDone=true 让 full reader 立即完成，worker 只用
          // range reader 路径，杜绝全量下载。
          const headRes = await fetch(pdfUrl, { method: 'HEAD' })
          if (!headRes.ok) throw new Error(`HTTP ${headRes.status}: 无法加载 PDF`)
          const fileSize = parseInt(headRes.headers.get('Content-Length') || '0', 10)
          if (fileSize <= 0) throw new Error('无法获取文件大小')
          totalBytes = fileSize

          // 不预取初始数据——full reader 由 progressiveDone 立即结束，
          // 所有数据走 range reader 路径，按需拉取。
          const emptyData = new Uint8Array(0)
          const rangeTransport = new pdfjs.PDFDataRangeTransport(fileSize, emptyData, true)

          let loaded = 0
          // 请求去重：相同 range 不重复 fetch
          const pendingRanges = new Map<string, Promise<void>>()
          rangeTransport.requestDataRange = function (begin: number, end: number) {
            const key = `${begin}-${end}`
            if (pendingRanges.has(key)) return // 已有相同请求在进行中
            // pdf.js 的 end 是 exclusive，HTTP Range 是 inclusive
            const p = fetch(pdfUrl, { headers: { Range: `bytes=${begin}-${end - 1}` } })
              .then(res => {
                if (!res.ok) throw new Error(`Range ${res.status}`)
                return res.arrayBuffer()
              })
              .then(data => {
                const chunk = new Uint8Array(data)
                loaded += chunk.byteLength
                rangeTransport.onDataRange(begin, chunk)
                rangeTransport.onDataProgress(loaded, fileSize)
              })
              .catch(() => { /* 静默处理 */ })
              .finally(() => { pendingRanges.delete(key) })
            pendingRanges.set(key, p)
          }

          doc = await pdfjs.getDocument({
            range: rangeTransport,
            disableRange: false,
            disableStream: false,
            disableAutoFetch: false,
            rangeChunkSize: 256 * 1024,  // 64KB→256KB：大字体/图像页减少 ~4x HTTP 往返（P15 类超慢页核心优化）
            cMapUrl: PDFJS_CMAP_URL,
            cMapPacked: true,
            standardFontDataUrl: PDFJS_STD_FONTS_URL,
          }).promise
        }

        if (off) return
        pdfDocRef.current = doc
        const n = doc.numPages
        setNumPages(n)
        const loadMs = Math.round(performance.now() - t0)
        setLoadStats({ time: loadMs, bytes: totalBytes })

        // 预取首页尺寸（不阻塞 ready）
        const firstPage = await doc.getPage(1)
        const firstVp = firstPage.getViewport({ scale: 1 })
        const firstSize = { width: firstVp.width, height: firstVp.height }
        const sizes: PageSize[] = new Array(n).fill(null).map(() => firstSize)
        if (off) return
        setPageSizes(sizes)
        setPhase('ready')

        // 后台并发探测页面真实尺寸（每批 8 页并发 getPage，单批一次 setPageSizes）
        // 原做法：每个不同尺寸各触发一次 setState → N 次 re-render；
        // 新做法：并发批次内收集差异，批次末单次 setState → re-render 次数降至 ceil(diff/8)。
        const PAGE_SIZE_BATCH = 8
        for (let start = 2; start <= n; start += PAGE_SIZE_BATCH) {
          if (off) return
          const end = Math.min(start + PAGE_SIZE_BATCH - 1, n)
          const chunk = Array.from({ length: end - start + 1 }, (_, k) => start + k)
          const batchDiff: [number, PageSize][] = []
          await Promise.all(chunk.map(async (i) => {
            try {
              const p = await doc.getPage(i)
              const vp = p.getViewport({ scale: 1 })
              const sz = { width: vp.width, height: vp.height }
              if (sz.width !== firstSize.width || sz.height !== firstSize.height) {
                batchDiff.push([i, sz])
              }
            } catch { /* skip */ }
          }))
          if (batchDiff.length > 0 && !off) {
            setPageSizes(prev => {
              const next = [...prev]
              for (const [i, sz] of batchDiff) next[i - 1] = sz
              return next
            })
          }
        }

      } catch (e) {
        if (off) return
        setErr(`PDF.js 加载失败：${String(e)}`)
        setPhase('error')
      }
    })()

    return () => { off = true; mupdfBufferRef.current = null }
  }, [pdfUrl, loadMode])

  // ── 后台拉完整 PDF → 加载进 mupdf Worker（两阶段渲染：pdfjs首屏 → mupdf接管） ──
  useEffect(() => {
    if (phase !== 'ready') return
    let off = false
    // 重置：新 PDF 加载时先回到 pdfjs 渲染
    mupdfActiveRef.current = false
    setMupdfActive(false)

    ;(async () => {
      try {
        let buffer: ArrayBuffer
        if (mupdfBufferRef.current) {
          // full 模式：直接复用已下载的 buffer，零额外请求
          buffer = mupdfBufferRef.current
          mupdfBufferRef.current = null
        } else {
          // range 模式：需要完整 buffer 才能给 mupdf，这里后台下载一次
          const res = await fetch(pdfUrl)
          if (!res.ok || off) return
          buffer = await res.arrayBuffer()
        }
        if (off) return
        await loadDocumentInWorker(buffer)
        if (off) return
        // Worker 文档就绪：清除 bitmap 缓存（让可见页用 mupdf 重渲染），激活 mupdf 路径
        bitmapCacheRef.current?.clear()
        mupdfActiveRef.current = true
        setMupdfActive(true)
      } catch { /* fetch/worker 失败：继续用 pdf.js */ }
    })()

    return () => {
      off = true
      unloadDocumentFromWorker()
    }
  }, [phase, pdfUrl])

  // ── 滚动监听：跟踪当前页 ──
  useEffect(() => {
    if (phase !== 'ready') return
    const vp = viewportRef.current
    if (!vp) return
    const handler = () => {
      let bestPage = 1
      let bestVisibility = 0
      const vpRect = vp.getBoundingClientRect()
      pageElsRef.current.forEach((el, page) => {
        const rect = el.getBoundingClientRect()
        const visibleTop = Math.max(rect.top, vpRect.top)
        const visibleBottom = Math.min(rect.bottom, vpRect.bottom)
        const visibleHeight = Math.max(0, visibleBottom - visibleTop)
        if (visibleHeight > bestVisibility) {
          bestVisibility = visibleHeight
          bestPage = page
        }
      })
      setCurrentPage(bestPage)
    }
    vp.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => vp.removeEventListener('scroll', handler)
  }, [phase])

  // ── 预渲染相邻页 (±3)：当 currentPage 稳定（visible 一段时间没变）时触发。
  //    prefetch 只在 idle 窗口内串行执行，不抢占首屏或滚动中的渲染。
  //    渲染结果存进 BitmapCache（同 cacheKey 命中 = drawImage 直接上屏）。
  useEffect(() => {
    if (phase !== 'ready') return
    if (numPages === 0) return
    const cp = currentPage
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)
    const cacheKey = (n: number) => `${n}@${scale.toFixed(2)}@${dpr}`
    const targets: number[] = []
    for (let d = 1; d <= 3; d++) {
      if (cp - d >= 1) targets.push(cp - d)
      if (cp + d <= numPages) targets.push(cp + d)
    }
    if (targets.length === 0) return
    // 只对还没缓存的页 prefetch
    const cancel = schedulePrefetch(
      targets,
      (n) => !bitmapCacheRef.current?.has(cacheKey(n)),
      async (n) => {
        const doc = pdfDocRef.current
        if (!doc) return
        let page: any = pageLRURef.current?.get(n)
        if (!page) {
          try {
            page = await doc.getPage(n)
            pageLRURef.current?.set(n, page)
          } catch { return }
        }
        // 临时 canvas：dpr 同当前一致；尺寸从 pageSizes 取
        const sz = pageSizes[n - 1]
        if (!sz) return
        const w = Math.round(sz.width * scale * dpr)
        const h = Math.round(sz.height * scale * dpr)
        // OffscreenCanvas：不触发主线程 layout/paint，比 createElement('canvas') 更轻量。
        // fallback 到 HTMLCanvasElement（旧浏览器）。
        let canvas: OffscreenCanvas | HTMLCanvasElement
        if (typeof OffscreenCanvas !== 'undefined') {
          canvas = new OffscreenCanvas(w, h)
        } else {
          if (typeof document === 'undefined') return
          const el = document.createElement('canvas')
          el.width = w
          el.height = h
          canvas = el
        }
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
        if (!ctx) return
        const vp = page.getViewport({ scale: scale * dpr })
        try {
          await page.render({ canvasContext: ctx, viewport: vp }).promise
        } catch { return }
        try {
          // OffscreenCanvas.transferToImageBitmap() 是同步的，比 createImageBitmap(canvas) 少一次 GPU 拷贝。
          const bmp = canvas instanceof OffscreenCanvas
            ? canvas.transferToImageBitmap()
            : (typeof createImageBitmap === 'function' ? await createImageBitmap(canvas) : null)
          if (bmp) bitmapCacheRef.current?.set(cacheKey(n), bmp)
        } catch { /* ignore */ }
      },
      { window: 1 }, // 串行：1 个 prefetch 不与主渲染争抢 worker
    )
    return cancel
  }, [phase, currentPage, numPages, scale, pageSizes])

  // ── 键盘快捷键 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
        return
      }
      if (e.key === 'Escape') {
        setShowSearch(false)
        setSearchQuery('')
        return
      }

      if (phase !== 'ready') return

      const cp = currentPageRef.current
      const np = numPagesRef.current
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        scrollToPage(cp + 1, np, pageElsRef)
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        scrollToPage(cp - 1, np, pageElsRef)
      }
      if (e.key === 'Home' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        scrollToPage(1, np, pageElsRef)
      }
      if (e.key === 'End' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        scrollToPage(np, np, pageElsRef)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase])

  // ── Ctrl/Cmd+滚轮缩放 ──
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setScale(s => Math.max(0.25, Math.min(5, s - e.deltaY * 0.002)))
      }
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [])

  // ── 搜索 ──
  const doSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q || !pdfDocRef.current) return
    setSearching(true)
    const doc = pdfDocRef.current
    const lower = q.toLowerCase()
    // 并发批次：原做法为串行 for-await，200 页 PDF = 400 个串行异步调用；
    // 改为每批 8 页并发 Promise.all，耗时降至 ~ceil(N/8) 轮。
    const SEARCH_CONCURRENCY = 8
    const hits: number[] = []
    for (let start = 1; start <= numPages; start += SEARCH_CONCURRENCY) {
      const end = Math.min(start + SEARCH_CONCURRENCY - 1, numPages)
      const chunk = Array.from({ length: end - start + 1 }, (_, k) => start + k)
      const chunkHits = await Promise.all(chunk.map(async (i) => {
        try {
          const page = await doc.getPage(i)
          const tc = await page.getTextContent()
          const text = (tc.items as Array<{ str: string }>).map(it => it.str).join('')
          return text.toLowerCase().includes(lower) ? i : null
        } catch { return null }
      }))
      for (const h of chunkHits) { if (h !== null) hits.push(h) }
    }
    hits.sort((a, b) => a - b)
    setSearchResults(hits)
    setActiveResultIdx(0)
    setSearching(false)
    if (hits.length > 0) {
      scrollToPage(hits[0], numPages, pageElsRef)
    }
  }, [searchQuery, numPages])

  const navigateSearch = useCallback((dir: number) => {
    const results = searchResultsRef.current
    const idx = activeResultIdxRef.current
    if (results.length === 0) return
    const next = (idx + dir + results.length) % results.length
    setActiveResultIdx(next)
    scrollToPage(results[next], numPagesRef.current, pageElsRef)
  }, [])

  // ── 下载 ──
  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = pdfUrl
    if (downloadName) a.download = downloadName
    a.click()
  }, [pdfUrl, downloadName])

  // ── 自适应宽度 ──
  const fitWidth = useCallback(() => {
    const w = viewportRef.current?.clientWidth ?? 720
    const firstW = pageSizes[0]?.width ?? 595
    setScale(Math.round((w - 32) / firstW * 100) / 100)
  }, [pageSizes])

  // ── 首屏耗时分解 ──
  const firstTiming = timings.find(t => t.page === 1)
  const avgRender = timings.length > 0
    ? Math.round(timings.reduce((s, t) => s + t.render1xMs + t.render2xMs, 0) / timings.length)
    : 0

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════

  if (phase === 'loading') {
    return (
      <div>
        <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onBack && <button onClick={onBack} style={{ borderColor: 'var(--border)' }}>← 返回</button>}
          <span className="kv">pdf.js 渲染中…</span>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 32px', color: 'var(--muted)' }}>
          <div className="pdf-skeleton" style={{ width: '60%', height: 16, margin: '0 auto 16px' }} />
          <div className="pdf-skeleton" style={{ width: '80%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '70%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '50%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '75%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '40%', height: 12, margin: '0 auto 0' }} />
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div>
        <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onBack && <button onClick={onBack} style={{ borderColor: 'var(--border)' }}>← 返回</button>}
        </div>
        <div className="panel" style={{ color: 'var(--red)' }}>{err}</div>
      </div>
    )
  }

  if (phase === 'ready' && pageSizes.length > 0) {
    return (
      <div>
        {/* ── 工具栏 ── */}
        <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {onBack && <button onClick={onBack} style={{ borderColor: 'var(--border)' }}>← 返回</button>}
          <span className="kv" style={{ whiteSpace: 'nowrap' }}>{label || `${numPages} 页 · 文字可复制`}</span>
          {loadStats && firstTiming && (
            <>
              <span className="kv" style={{ whiteSpace: 'nowrap' }}>
                <b style={{ color: 'var(--green)', fontSize: 14 }}>{loadStats.time + firstTiming.getPageMs + firstTiming.render1xMs}ms</b>
                <span style={{ color: 'var(--green)' }}> 首帧可见</span>
              </span>
              <span className="kv" style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}>
                加载{loadStats.time}ms{loadStats.bytes > 0 ? `(${(loadStats.bytes / 1024).toFixed(0)}KB)` : ''} → getPage{firstTiming.getPageMs}ms → 1x渲染{firstTiming.render1xMs}ms
                {loadMode === 'range' ? ' (含按需拉取资源)' : ' (纯canvas)'}
              </span>
              <span className="kv" style={{ color: 'var(--muted)', fontSize: 10, whiteSpace: 'nowrap' }}>
                2x升级{firstTiming.render2xMs}ms + 文字层{firstTiming.textLayerMs}ms = 完整{firstTiming.totalMs}ms
              </span>
            </>
          )}
          {loadStats && !firstTiming && (
            <span className="kv" style={{ color: 'var(--green)', whiteSpace: 'nowrap' }}>
              文档加载 {loadStats.time}ms{loadStats.bytes > 0 ? ` · ${(loadStats.bytes / 1024).toFixed(0)}KB` : ''}
            </span>
          )}
          {showLoadModeToggle && !forcedLoadMode && (
            <button
              onClick={() => setLoadMode(m => m === 'range' ? 'full' : 'range')}
              style={{ borderColor: loadMode === 'range' ? 'var(--green)' : 'var(--yellow)', fontSize: 11 }}
              title={loadMode === 'range' ? '当前：分片加载（Range 请求）' : '当前：全量加载（fetch 整个文件）'}
            >
              {loadMode === 'range' ? '📡 分片' : '📦 全量'}
            </button>
          )}
          <span style={{ flex: 1 }} />

          {/* 页面导航 */}
          <button
            onClick={() => scrollToPage(currentPage - 1, numPages, pageElsRef)}
            disabled={currentPage <= 1}
            title="上一页 (←/↑/PgUp)"
          >◂</button>
          <input
            type="number"
            className="pdf-page-input"
            value={currentPage}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              if (v >= 1 && v <= numPages) scrollToPage(v, numPages, pageElsRef)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = parseInt((e.target as HTMLInputElement).value)
                if (v >= 1 && v <= numPages) scrollToPage(v, numPages, pageElsRef)
              }
            }}
            min={1}
            max={numPages}
          />
          <span className="kv" style={{ whiteSpace: 'nowrap' }}>/ {numPages}</span>
          <button
            onClick={() => scrollToPage(currentPage + 1, numPages, pageElsRef)}
            disabled={currentPage >= numPages}
            title="下一页 (→/↓/PgDn)"
          >▸</button>

          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

          {/* 缩放 */}
          <button onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}>－</button>
          <span className="kv" style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(5, s + 0.25))}>＋</button>
          <button onClick={() => setScale(1.0)} style={{ borderColor: 'var(--border)' }}>100%</button>
          <button onClick={fitWidth} style={{ borderColor: 'var(--border)' }}>适应宽度</button>

          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

          {/* 搜索 */}
          <button
            onClick={() => setShowSearch(s => !s)}
            style={{ borderColor: showSearch ? 'var(--accent)' : 'var(--border)' }}
            title="搜索 (Ctrl+F)"
          >🔍</button>

          {/* 下载 */}
          <button onClick={handleDownload} style={{ borderColor: 'var(--border)' }} title="下载 PDF">⬇</button>
        </div>

        {/* ── 渲染耗时明细面板 ── */}
        {showTiming && timings.length > 0 && (
          <div className="panel" style={{ padding: '8px 16px', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
            <div className="kv" style={{ marginBottom: 6 }}>
              逐屏渲染耗时 · 已渲染 <b>{timings.length}</b> 页 · 平均渲染 <b>{avgRender}ms</b>
              {loadMode === 'range' && <span style={{ color: 'var(--yellow)' }}> · 1x渲染含按需拉取资源</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {timings.sort((a, b) => a.page - b.page).map(t => (
                <span key={t.page} style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: t.page === 1 ? 'rgba(47,129,247,0.15)' : '#21262d',
                  border: `1px solid ${t.page === 1 ? 'var(--accent)' : 'var(--border)'}`,
                  whiteSpace: 'nowrap',
                }}>
                  P{t.page}: <b style={{ color: 'var(--green)' }}>{t.totalMs}ms</b>
                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                    {' '}= {t.getPageMs}+{t.render1xMs}+{t.render2xMs}+{t.textLayerMs}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 搜索栏 ── */}
        {showSearch && (
          <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px' }}>
            <input
              type="text"
              className="pdf-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); doSearch() }
                if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); setSearchResults([]) }
              }}
              placeholder="搜索文档内容…"
              autoFocus
            />
            {searching && <span className="kv">搜索中…</span>}
            {!searching && searchResults.length > 0 && (
              <>
                <span className="kv">{activeResultIdx + 1} / {searchResults.length}</span>
                <button onClick={() => navigateSearch(-1)}>◂</button>
                <button onClick={() => navigateSearch(1)}>▸</button>
              </>
            )}
            {!searching && searchResults.length === 0 && searchQuery && (
              <span className="kv" style={{ color: 'var(--red)' }}>无匹配</span>
            )}
            <button
              onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]) }}
              style={{ borderColor: 'var(--border)' }}
            >✕</button>
          </div>
        )}

        {/* ── PDF 视口 ── */}
        <div
          ref={viewportRef}
          className="pdf-viewport viewport"
          style={{ height: 'calc(100vh - 240px)', minHeight: 640, overflow: 'auto', background: '#525659', borderRadius: 8, padding: 16 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {pageSizes.map((sz, i) => {
              const pageNum = i + 1
              const isSearchHit = searchResults.length > 0 && searchResults.includes(pageNum)
              const isActiveHit = isSearchHit && searchResults[activeResultIdx] === pageNum
              return (
                <PdfPage
                  key={pageNum}
                  index={i}
                  base={sz}
                  scale={scale}
                  pdfDocRef={pdfDocRef}
                  viewportRef={viewportRef}
                  pageElRef={(el) => {
                    if (el) pageElsRef.current.set(pageNum, el)
                    else pageElsRef.current.delete(pageNum)
                  }}
                  isSearchHit={isSearchHit}
                  isActiveHit={isActiveHit}
                  onTiming={onPageTiming}
                  currentPageRef={currentPageRef}
                  renderQueueRef={renderQueueRef}
                  pageLRURef={pageLRURef}
                  bitmapCacheRef={bitmapCacheRef}
                  cleanupSchedulerRef={cleanupSchedulerRef}
                  mupdfActive={mupdfActive}
                  mupdfActiveRef={mupdfActiveRef}
                />
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function scrollToPage(page: number, numPages: number, pageElsRef: React.MutableRefObject<Map<number, HTMLDivElement>>) {
  const p = Math.max(1, Math.min(numPages, page))
  const el = pageElsRef.current.get(p)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// ── 单页渲染（两遍 canvas + 延后文字层） ─────────────────────────────────────
// 渲染队列 / PageLRU / BitmapCache 改为 per-instance refs（在 PdfViewer 里创建），
// 取代原先的模块级 renderQueue。这样多个 PdfViewer 实例互不干扰，且组件
// unmount 时能正确清理（drain 队列 + cleanup 所有 page + close 所有 bitmap）。

function PdfPage({
  index, base, scale, pdfDocRef, pageElRef, viewportRef,
  isSearchHit, isActiveHit, onTiming,
  currentPageRef, renderQueueRef, pageLRURef, bitmapCacheRef, cleanupSchedulerRef,
  mupdfActive, mupdfActiveRef,
}: {
  index: number
  base: PageSize
  scale: number
  pdfDocRef: React.MutableRefObject<any>
  pageElRef: (el: HTMLDivElement | null) => void
  viewportRef: React.RefObject<HTMLDivElement | null>
  isSearchHit?: boolean
  isActiveHit?: boolean
  onTiming?: (t: PageTiming) => void
  currentPageRef: React.MutableRefObject<number>
  renderQueueRef: React.MutableRefObject<RenderQueue | null>
  pageLRURef: React.MutableRefObject<PageLRU<any> | null>
  bitmapCacheRef: React.MutableRefObject<BitmapCache<string> | null>
  cleanupSchedulerRef: React.MutableRefObject<WasmCleanupScheduler | null>
  mupdfActive: boolean
  mupdfActiveRef: React.MutableRefObject<boolean>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<any>(null)
  const textLayerRef = useRef<any>(null)
  const textLayerCancelRef = useRef<(() => void) | null>(null)
  const [visible, setVisible] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timedRef = useRef(false)
  const renderedRef = useRef(false)

  const W = base.width * scale
  const H = base.height * scale

  useEffect(() => {
    pageElRef(wrapRef.current)
    return () => pageElRef(null)
  }, [pageElRef])

  // ── 即时 BitmapCache 绘制：在浏览器 paint 前同步执行，消除来回滚动时的白帧 ──
  // 原流程：visible=true → useEffect 异步排队 → 0~12000ms 后渲染 → 才显示内容。
  // 新流程：useLayoutEffect 在同一帧 paint 前同步 drawImage → 第一帧就有内容。
  // 对 BitmapCache 命中的页（用户已访问过的页）效果最明显：完全零白屏。
  useLayoutEffect(() => {
    if (!visible) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cacheKey = `${index + 1}@${scale.toFixed(2)}@${dpr}`
    const bmp = bitmapCacheRef.current?.get(cacheKey)
    if (!bmp) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(bmp, 0, 0)
    // renderedRef 不在这里设为 true：让后续 useEffect 照常运行，
    // 以便 scheduleTextLayer 被调度（保障文字选取/复制功能）。
  }, [visible, index, scale, W, H, bitmapCacheRef])

  // 使用 pdf-viewport 作为 IntersectionObserver 的 root，追踪页面在滚动容器内的可见性
  useEffect(() => {
    const el = wrapRef.current
    const root = viewportRef.current
    if (!el || !root) return
    let hideTimer: ReturnType<typeof setTimeout>
    const io = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries[0]?.isIntersecting ?? false
        if (isIntersecting) {
          clearTimeout(hideTimer)
          setVisible(true)
        } else {
          // 延迟 500ms 隐藏，避免快速滚动时频繁闪烁
          hideTimer = setTimeout(() => {
            setVisible(false)
            renderedRef.current = false
          }, 500)
        }
      },
      { root, rootMargin: '1200px' },
    )
    io.observe(el)
    return () => { io.disconnect(); clearTimeout(hideTimer) }
  }, [viewportRef])

  useEffect(() => {
    if (!visible) {
      renderTaskRef.current?.cancel?.()
      // 取消可能 pending 的渲染任务
      renderQueueRef.current?.cancel(index + 1)
      // 取消延后的文字层
      textLayerCancelRef.current?.()
      textLayerCancelRef.current = null
      try { textLayerRef.current?.cancel?.() } catch { /* noop */ }
      // 清空 canvas DOM（不清空 LRU/bitmap cache，它们可能被复用）
      if (canvasRef.current) {
        canvasRef.current.width = 0
        canvasRef.current.height = 0
      }
      if (textRef.current) {
        textRef.current.innerHTML = ''
      }
      return
    }

    // mupdf 刚激活：让已渲染的 pdfjs 页面重新走 mupdf 路径
    if (mupdfActive && renderedRef.current) {
      renderedRef.current = false
    }

    if (renderedRef.current) return

    let cancelled = false
    const pageNum = index + 1
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const queue = renderQueueRef.current
    const lru = pageLRURef.current
    const cache = bitmapCacheRef.current
    const cacheKey = `${pageNum}@${scale.toFixed(2)}@${dpr}`

    const renderFn = async () => {
      if (cancelled) return
      const doc = pdfDocRef.current
      const canvas = canvasRef.current
      if (!doc || !canvas) return
      try {
        const t0 = performance.now()

        // 0. BitmapCache 命中：跳过整个 pdf.js render，直接 drawImage
        //    用户来回滚动同一页时命中率最高，省一次完整的 render
        const cachedBmp = cache?.get(cacheKey)
        if (cachedBmp) {
          canvas.width = cachedBmp.width
          canvas.height = cachedBmp.height
          canvas.style.width = `${W}px`
          canvas.style.height = `${H}px`
          const ctx = canvas.getContext('2d')!
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(cachedBmp, 0, 0)
          if (cancelled) return
          // bitmap 命中路径：仍需要 page 才能渲染文字层（用户要框选复制）
          // 优先从 LRU 取；没有则 doc.getPage（比 render 快得多，仅解元数据）
          let pageForText = lru?.get(pageNum) ?? null
          if (!pageForText) {
            try {
              pageForText = await doc.getPage(pageNum)
              if (lru) lru.set(pageNum, pageForText)
            } catch { pageForText = null }
          }
          if (cancelled) return
          renderedRef.current = true
          cleanupSchedulerRef.current?.recordRender()
          if (!timedRef.current && onTiming) {
            timedRef.current = true
            onTiming({
              page: pageNum,
              getPageMs: 0, render1xMs: 0, render2xMs: 0, textLayerMs: 0,
              totalMs: Math.round(performance.now() - t0),
            })
          }
          scheduleTextLayer(pageForText)
          return
        }

        // 1a. mupdf 路径（优先）：Worker 内渲染，比 pdf.js 快 ~10x
        if (mupdfActiveRef.current) {
          try {
            const dpr2 = Math.min(window.devicePixelRatio || 1, 2)
            const imageData = await renderPageWithMupdf(pageNum - 1, scale, dpr2)
            if (cancelled) return
            canvas.width = imageData.width
            canvas.height = imageData.height
            canvas.style.width = `${W}px`
            canvas.style.height = `${H}px`
            const ctx = canvas.getContext('2d')!
            ctx.putImageData(imageData, 0, 0)
            // 存 ImageBitmap 缓存，滚回时 drawImage 零延迟
            if (cache && typeof createImageBitmap === 'function') {
              try {
                const bmp = await createImageBitmap(canvas)
                if (!cancelled) cache.set(cacheKey, bmp)
              } catch { /* ignore */ }
            }
            if (cancelled) return
            renderedRef.current = true
            cleanupSchedulerRef.current?.recordRender()
            if (!timedRef.current && onTiming) {
              timedRef.current = true
              onTiming({
                page: pageNum,
                getPageMs: 0,
                render1xMs: Math.round(performance.now() - t0),
                render2xMs: 0,
                textLayerMs: 0,
                totalMs: Math.round(performance.now() - t0),
              })
            }
            // 文字层仍用 pdf.js（mupdf 不暴露文字位置 API）
            let pageForText = lru?.get(pageNum) ?? null
            if (!pageForText) {
              try {
                const doc = pdfDocRef.current
                if (doc) { pageForText = await doc.getPage(pageNum); if (lru) lru.set(pageNum, pageForText) }
              } catch { /* ignore */ }
            }
            scheduleTextLayer(pageForText)
          } catch {
            /* mupdf 失败（Worker 未就绪等）→ fall through to pdf.js */
          }
          if (renderedRef.current) return
        }

        // 1b. pdf.js 路径（fallback / mupdf 未就绪时）
        // 获取页面对象（PageLRU 复用：同一 pageNum 不重复 getPage）
        let page = lru?.get(pageNum)
        if (!page) {
          page = await doc.getPage(pageNum)
          if (cancelled) return
          if (lru) lru.set(pageNum, page)
        }
        const t1 = performance.now()

        // 2. 首遍渲染：1x DPR（最快上屏）
        const vp1x = page.getViewport({ scale: scale * 1 })
        canvas.width = vp1x.width
        canvas.height = vp1x.height
        canvas.style.width = `${W}px`
        canvas.style.height = `${H}px`
        canvas.style.imageRendering = 'auto'
        renderTaskRef.current?.cancel?.()
        const ctx1x = canvas.getContext('2d')!
        ctx1x.clearRect(0, 0, canvas.width, canvas.height)
        const task1x = page.render({ canvasContext: ctx1x, viewport: vp1x })
        renderTaskRef.current = task1x
        await task1x.promise
        if (cancelled) return
        const t2 = performance.now()

        // 3. 二遍渲染：2x DPR（高清升级），用 rAF 让出主线程先上屏
        let render2xMs = 0
        if (dpr > 1) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          if (cancelled) return
          const vp2x = page.getViewport({ scale: scale * dpr })
          canvas.width = vp2x.width
          canvas.height = vp2x.height
          canvas.style.width = `${W}px`
          canvas.style.height = `${H}px`
          const ctx2x = canvas.getContext('2d')!
          ctx2x.clearRect(0, 0, canvas.width, canvas.height)
          const task2x = page.render({ canvasContext: ctx2x, viewport: vp2x })
          renderTaskRef.current = task2x
          await task2x.promise
          if (cancelled) return
          render2xMs = Math.round(performance.now() - t2)

          // 4. 把最终 2x DPR 的位图转 ImageBitmap 缓存，
          //    下次该页进入视口时直接 drawImage（省一次完整 pdf.js render）
          if (cache && typeof createImageBitmap === 'function') {
            try {
              const bmp = await createImageBitmap(canvas)
              cache.set(cacheKey, bmp)
            } catch { /* 忽略：旧浏览器或 OffscreenCanvas 不可用 */ }
          }
        }

        // 5. 文字层：延后到 requestIdleCallback，不阻塞首屏可见
        scheduleTextLayer(page)

        renderedRef.current = true
        cleanupSchedulerRef.current?.recordRender()

        // 6. 上报耗时（仅首次渲染上报，文字层独立算）
        if (!timedRef.current && onTiming) {
          timedRef.current = true
          const totalMs = Math.round(performance.now() - t0)
          onTiming({
            page: pageNum,
            getPageMs: Math.round(t1 - t0),
            render1xMs: Math.round(t2 - t1),
            render2xMs,
            textLayerMs: 0, // 文字层 idle 触发，不计入本次 total
            totalMs,
          })
        }
      } catch {
        /* render cancelled */
      }
    }

    function scheduleTextLayer(page: any) {
      const plan = planTextLayer({
        cancelled,
        hasDiv: !!textRef.current,
        hasPage: !!page,
      })
      if (!plan.proceed) return
      // 取消上一次调度（如果还在等）
      textLayerCancelRef.current?.()
      textLayerCancelRef.current = scheduleIdleTask(async () => {
        if (cancelled) return
        const textDiv = textRef.current
        if (!textDiv) return
        const tt0 = performance.now()
        textDiv.innerHTML = ''
        textDiv.style.width = `${W}px`
        textDiv.style.height = `${H}px`
        textDiv.style.setProperty('--scale-factor', String(scale))
        try {
          const textContent = await page.getTextContent()
          if (cancelled) { textDiv.innerHTML = ''; return }
          const pdfjs = await loadPdfjs()
          if (pdfjs.TextLayer) {
            const tl = new pdfjs.TextLayer({
              textContentSource: textContent,
              container: textDiv,
              viewport: page.getViewport({ scale }),
            })
            textLayerRef.current = tl
            await tl.render()
          } else if (pdfjs.renderTextLayer) {
            await pdfjs.renderTextLayer({
              textContentSource: textContent,
              container: textDiv,
              viewport: page.getViewport({ scale }),
            }).promise
          }
          if (cancelled) { textDiv.innerHTML = ''; return }
          // 上报文字层耗时（独立计时，便于调试 idle 调度延迟）
          const textLayerMs = Math.round(performance.now() - tt0)
          if (onTiming && textLayerMs > 0) {
            onTiming({
              page: pageNum,
              getPageMs: 0, render1xMs: 0, render2xMs: 0,
              textLayerMs, totalMs: textLayerMs,
            })
          }
        } catch { /* idle cancelled or pdf.js error */ }
      }, { timeout: 1500 })
    }

    // 优先级：距离当前视口越近越优先（小优先 = 高优先）
    const priority = Math.abs(pageNum - (currentPageRef.current ?? 1))

    queue?.enqueue({
      pageNum,
      priority,
      start: renderFn,
      cancel: () => { cancelled = true },
    })

    return () => {
      cancelled = true
      queue?.cancel(pageNum)
      textLayerCancelRef.current?.()
      textLayerCancelRef.current = null
      try { textLayerRef.current?.cancel?.() } catch { /* noop */ }
    }
  }, [visible, scale, index, W, H, pdfDocRef, onTiming, currentPageRef, renderQueueRef, pageLRURef, bitmapCacheRef, mupdfActive, mupdfActiveRef])

  let boxShadow = '0 2px 12px rgba(0,0,0,.4)'
  if (isActiveHit) {
    boxShadow = '0 0 0 4px var(--accent), 0 2px 12px rgba(0,0,0,.4)'
  } else if (isSearchHit) {
    boxShadow = '0 0 0 2px var(--yellow)'
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        width: W,
        height: H,
        // canvas 渲染后会覆盖此背景；未渲染时显示骨架灰而非刺眼的纯白
        background: '#e8e8e8',
        boxShadow,
        flexShrink: 0,
        transition: 'box-shadow 0.2s',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 1, background: '#fff' }} />
      <div
        ref={textRef}
        className="textLayer"
        style={{ position: 'absolute', inset: 0, zIndex: 2 }}
      />
      <span style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 11, color: '#999', zIndex: 3, userSelect: 'none' }}>
        {index + 1}
      </span>
    </div>
  )
}