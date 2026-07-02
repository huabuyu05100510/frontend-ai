// PdfPreviewWASM v2：WASM PDF 全文档查看器（Worker + 渐进式渲染 + 虚拟滚动）
// 模型：claude-sonnet-4-6
//
// v2 改动：
//   - 所有渲染通过 PdfWasmCoordinator → Web Worker
//   - 渐进式渲染：0.5x 低清 ImageBitmap 先显示 → 1.0x 全清替换
//   - IntersectionObserver + 优先级队列（可见页按距中心排序）
//   - 预取 buffer_pages=2，文字层在渲染完成后异步提取
//   - 位图缓存命中时跳过 Worker render
//   - 缩放防抖 cancel 旧渲染
//   - 内存管理由 Coordinator 统一处理
//
// v2.1 视口优先渲染（白屏修复）：
//   - 严格视口（threshold=0.01）vs 预取区（rootMargin）分开处理
//   - 视口内页面 priority=high，预取页面 priority=low
//   - 页面滚出视口时立即 cancel 其 Worker 渲染
//   - 快速滚动检测：velocity > 阈值时跳过非视口页渲染，等 deceleration 后再触发
//   - 滚动停止 idle 200ms 后才开始渲染预取 buffer 页
//
// 可观测：所有日志前缀 [pdf-wasm-v2]

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePerf, tickMemory } from '../perf'
import { getCoordinator } from './pdf-wasm/coordinator'
import { buildTextLayerFromCharBoxes } from './pdf-wasm/text-layer-builder'

// ============ 组件 ============

interface Props {
  url: string
  docSize?: number
  /** 服务端文字层 URL 模板（如 /api/files/:id?as=text&n=N，上传文件可用） */
  serverTextUrlTemplate?: string
}

type Phase = 'loading' | 'rendering' | 'ready' | 'error'

const BUFFER_PAGES = 2
// 缩放时先渲染可见 + 预取的页面（视口附近），逐步扩展
const INITIAL_PAGES = 3

export function PdfPreviewWASM({ url, docSize = 0, serverTextUrlTemplate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [statusMsg, setStatusMsg] = useState('')

  const st = usePerf.getState()
  const docIdRef = useRef(0)
  const releaseRef = useRef<(() => void) | null>(null)
  const tokenRef = useRef(0)
  const renderedPagesRef = useRef<Set<number>>(new Set())
  const pageSizesRef = useRef<Map<number, { w: number; h: number }>>(new Map())

  // ========== 文档加载 ==========
  useEffect(() => {
    let cancelled = false
    const coordinator = getCoordinator()
    tokenRef.current++

    const loadDoc = async () => {
      setPhase('loading')
      setStatusMsg('初始化 Worker…')
      console.log('[pdf-wasm-v2] load', url)
      st.set({ docUrl: url, docSize, downloaded: 0, tLoadStart: performance.now(), wasmProgressivePhase: 'idle' })

      try {
        const { docId, pageCount: pc, pageSizes, release } = await coordinator.openDocument(url)
        if (cancelled) { release(); return }

        docIdRef.current = docId
        releaseRef.current = release
        st.set({ pages: pc })

        // 缓存页尺寸
        for (let i = 0; i < pageSizes.length; i++) {
          pageSizesRef.current.set(i + 1, { w: pageSizes[i].w * scale, h: pageSizes[i].h * scale })
        }

        setPageCount(pc)
        setPhase('rendering')
        setStatusMsg('渲染页面…')
        console.log('[pdf-wasm-v2] doc loaded', pc, 'pages')
      } catch (e: any) {
        if (!cancelled) {
          console.error('[pdf-wasm-v2] load error', e)
          setErrMsg(e?.message || String(e))
          setPhase('error')
        }
      }
    }

    loadDoc()

    return () => {
      cancelled = true
      if (releaseRef.current) {
        releaseRef.current()
        releaseRef.current = null
      }
      docIdRef.current = 0
    }
  }, [url])

  // ========== 槽位管理（phase='rendering' 时创建） ==========
  useEffect(() => {
    if (phase !== 'rendering' || pageCount === 0) return
    const pagesEl = pagesContainerRef.current
    if (!pagesEl) return

    pagesEl.innerHTML = ''
    const DEFAULT_W = 595 * scale
    const DEFAULT_H = 842 * scale

    for (let i = 1; i <= pageCount; i++) {
      const slot = document.createElement('div')
      slot.className = 'pdf-slot'
      slot.dataset.page = String(i)
      const size = pageSizesRef.current.get(i)
      slot.style.width = `${size?.w || DEFAULT_W}px`
      slot.style.height = `${size?.h || DEFAULT_H}px`
      slot.innerHTML = '<div class="page-skeleton"></div>'
      pagesEl.appendChild(slot)
    }

    console.log('[pdf-wasm-v2] created', pageCount, 'slots')
  }, [phase, pageCount, scale])

  // ========== 视口虚拟化：可见页优先渲染（v2.1 白屏修复） ==========
  useEffect(() => {
    if (phase !== 'rendering' || pageCount === 0) return
    const el = containerRef.current
    const pagesEl = pagesContainerRef.current
    if (!el || !pagesEl) return

    el.scrollTop = 0
    const myToken = ++tokenRef.current
    const coordinator = getCoordinator()
    const docId = docIdRef.current

    // ====== 滚动速度检测 ======
    let lastScrollTime = performance.now()
    let lastScrollTop = el.scrollTop
    let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null
    let isFastScrolling = false
    const FAST_SCROLL_PX_PER_MS = 0.5  // 像素/毫秒：超过此值视为快速滚动
    const SCROLL_IDLE_MS = 200          // 滚动停止后等待时间

    // 当前视口内页面集合（严格视口，不含 rootMargin）
    const viewportPages = new Set<number>()

    // ====== 取消页面的 Worker 渲染 ======
    const cancelSlotRender = (slot: HTMLElement) => {
      const pageNum = Number(slot.dataset.page)
      if (slot.dataset.rendering === 'true') {
        coordinator.cancelPageRender(docId, pageNum)
        slot.dataset.rendering = 'false'
        console.log('[pdf-wasm-v2] cancel slot', pageNum)
      }
    }

    // ====== 滚动监听：速度检测 + 取消离开视口的渲染 + idle 预取 ======
    const onScroll = () => {
      const now = performance.now()
      const dt = Math.max(now - lastScrollTime, 1)
      const dy = Math.abs(el.scrollTop - lastScrollTop)
      const velocity = dy / dt

      lastScrollTime = now
      lastScrollTop = el.scrollTop

      if (velocity > FAST_SCROLL_PX_PER_MS) {
        if (!isFastScrolling) {
          isFastScrolling = true
          console.log('[pdf-wasm-v2] fast scrolling detected, velocity=', velocity.toFixed(1), 'px/ms')
          // 取消所有非视口页的渲染
          pagesEl.querySelectorAll<HTMLElement>('[data-page]').forEach(s => {
            const pn = Number(s.dataset.page)
            if (!viewportPages.has(pn)) cancelSlotRender(s)
          })
        }
      }

      // 重置 idle timer
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
      scrollIdleTimer = setTimeout(() => {
        if (isFastScrolling) {
          isFastScrolling = false
          console.log('[pdf-wasm-v2] scroll idle, prefetching buffer')
          // Idle 后预取 buffer 页面
          prefetchBufferPages()
        }
      }, SCROLL_IDLE_MS)
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    // ====== 预取当前视口周围的 buffer 页面 ======
    const prefetchBufferPages = () => {
      if (viewportPages.size === 0) return
      const visibleArr = Array.from(viewportPages)
      const centerPage = visibleArr.reduce((a, b) => Math.abs(a - visibleArr[0] || a) < Math.abs(b - visibleArr[0] || b) ? a : b, visibleArr[0])
      for (let p = Math.max(1, centerPage - BUFFER_PAGES - 1); p <= Math.min(pageCount, centerPage + BUFFER_PAGES + 1); p++) {
        if (viewportPages.has(p)) continue
        const slot = pagesEl.querySelector<HTMLElement>(`[data-page="${p}"]`)
        if (slot && !slot.dataset.renderedToken && slot.dataset.rendering !== 'true') {
          renderSlot(slot, p, coordinator, docId, scale, myToken, serverTextUrlTemplate, false)
        }
      }
    }

    // ====== 立即渲染首屏 ======
    const initialPages = Math.min(pageCount, INITIAL_PAGES)
    for (let i = 1; i <= initialPages; i++) {
      const slot = pagesEl.querySelector<HTMLElement>(`[data-page="${i}"]`)
      if (slot) {
        viewportPages.add(i)
        renderSlot(slot, i, coordinator, docId, scale, myToken, serverTextUrlTemplate, true)
      }
    }

    if (pageCount <= INITIAL_PAGES) {
      setTimeout(() => setPhase('ready'), 500)
    }

    // ====== IntersectionObserver：区分严格视口 vs rootMargin 预取区 ======
    const observer = new IntersectionObserver((entries) => {
      const newViewport = new Set<number>()

      // 严格视口内（isIntersecting + 至少部分可见）
      const inStrictViewport: Array<{ slot: HTMLElement; pageNum: number; dist: number }> = []
      // rootMargin 区域（可见但不在视口内）
      const inBufferZone: Array<{ slot: HTMLElement; pageNum: number; dist: number }> = []

      for (const e of entries) {
        const slot = e.target as HTMLElement
        const pageNum = Number(slot.dataset.page)
        const dist = Math.abs((e.boundingClientRect.top + e.boundingClientRect.bottom) / 2 - el.clientHeight / 2)

        if (e.isIntersecting) {
          const slotRect = e.boundingClientRect
          const containerRect = el.getBoundingClientRect()
          // 判断是否在严格视口内（有实际像素交叠，不仅仅是 rootMargin）
          const overlaps = !(slotRect.bottom <= containerRect.top || slotRect.top >= containerRect.bottom)
          if (overlaps) {
            newViewport.add(pageNum)
            inStrictViewport.push({ slot, pageNum, dist })
          } else {
            inBufferZone.push({ slot, pageNum, dist })
          }
        } else {
          // 离开视口 → cancel
          cancelSlotRender(slot)
        }
      }

      // 左区离开的页面 cancel
      for (const oldP of viewportPages) {
        if (!newViewport.has(oldP)) {
          const slot = pagesEl.querySelector<HTMLElement>(`[data-page="${oldP}"]`)
          if (slot) cancelSlotRender(slot)
        }
      }
      viewportPages.clear()
      for (const p of newViewport) viewportPages.add(p)

      // 渲染严格视口内页面（按距中心排序，最近优先）
      inStrictViewport.sort((a, b) => a.dist - b.dist)
      for (const { slot, pageNum } of inStrictViewport) {
        renderSlot(slot, pageNum, coordinator, docId, scale, myToken, serverTextUrlTemplate, false)
      }

      // 标记 ready
      if (renderedPagesRef.current.size >= Math.min(pageCount, INITIAL_PAGES)) {
        setPhase('ready')
        setStatusMsg('')
      }

      // 非快速滚动时，预取 buffer 区页面
      if (!isFastScrolling && inBufferZone.length > 0) {
        for (const { slot, pageNum } of inBufferZone) {
          if (!slot.dataset.renderedToken && slot.dataset.rendering !== 'true') {
            renderSlot(slot, pageNum, coordinator, docId, scale, myToken, serverTextUrlTemplate, false)
          }
        }
      }

      // 快速滚动时只渲染视口+1页（否则滚太快显示的全是骨架）
      if (isFastScrolling && inStrictViewport.length > 0) {
        const centerPage = inStrictViewport[0].pageNum
        for (let p = Math.max(1, centerPage - 1); p <= Math.min(pageCount, centerPage + 1); p++) {
          if (viewportPages.has(p)) continue
          const slot = pagesEl.querySelector<HTMLElement>(`[data-page="${p}"]`)
          if (slot && !slot.dataset.renderedToken && slot.dataset.rendering !== 'true') {
            renderSlot(slot, p, coordinator, docId, scale, myToken, serverTextUrlTemplate, false)
          }
        }
      }
    }, { root: el, rootMargin: `${BUFFER_PAGES * 600}px 0px`, threshold: 0.01 })

    // 观察所有 slot
    setTimeout(() => {
      pagesEl.querySelectorAll<HTMLElement>('[data-page]').forEach(s => observer.observe(s))
    }, 50)

    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
    }
  }, [phase, pageCount, scale, serverTextUrlTemplate])

  // ========== 缩放控制 ==========
  const scaleTimer = useRef<ReturnType<typeof setTimeout>>()
  const zoom = useCallback((delta: number) => {
    setScale(s => {
      const next = Math.max(0.5, Math.min(3, +(s + delta).toFixed(2)))
      if (next === s) return s

      clearTimeout(scaleTimer.current)
      scaleTimer.current = setTimeout(() => {
        const newToken = ++tokenRef.current
        const coordinator = getCoordinator()
        const docId = docIdRef.current

        // 清空 old bitmaps & slots
        coordinator.evictDocBitmaps(docId)
        renderedPagesRef.current.clear()
        pageSizesRef.current.clear()
        st.set({ renderedPages: 0 })

        // 重建 slot 尺寸
        const pagesEl = pagesContainerRef.current
        if (pagesEl) {
          pagesEl.querySelectorAll<HTMLElement>('[data-page]').forEach(sl => {
            sl.innerHTML = '<div class="page-skeleton"></div>'
            delete sl.dataset.renderedToken
          })
        }

        // 触发重渲染（依赖 scale 的 effect 会重新跑）
      }, 200)
      return next
    })
  }, [])

  // ========== 内存监控 ==========
  useEffect(() => {
    const t = setInterval(tickMemory, 2000)
    tickMemory()
    return () => clearInterval(t)
  }, [])

  // ============ 渲染 ============
  return (
    <div className="pdf-root">
      <div className="pdf-toolbar">
        <span>共 {pageCount} 页 · 已渲染 <RenderedCount/> · {statusMsg || phase}</span>
        <div className="spacer" />
        <button className="btn-mini" onClick={() => zoom(-0.2)}>−</button>
        <span className="scale-text">{Math.round(scale * 100)}%</span>
        <button className="btn-mini" onClick={() => zoom(0.2)}>＋</button>
      </div>

      <div className="pdf-container" ref={containerRef}>
        {phase === 'loading' && <div className="center-msg">下载PDF中…</div>}
        {phase === 'error' && <div className="center-msg err">加载失败：{errMsg}</div>}
        {(phase === 'rendering' || phase === 'ready') && (
          <div className="pdf-pages" ref={pagesContainerRef} />
        )}
      </div>
    </div>
  )
}

// ============ 单页渲染 ============

function renderSlot(
  slot: HTMLElement,
  pageNum: number,
  coordinator: ReturnType<typeof getCoordinator>,
  docId: number,
  scale: number,
  token: number,
  serverTextUrlTemplate?: string,
  isInitial?: boolean,
) {
  const doProgressive = isInitial || false

  // 如果 slot 已经不在 DOM 中，或已经渲染完成，跳过
  if (!slot.isConnected) return
  if (slot.dataset.rendering === 'true' || slot.dataset.renderedToken) return
  slot.dataset.rendering = 'true'

  const t0 = performance.now()

  coordinator.requestRender(docId, pageNum, scale, {
    priority: 'high',
    skipProgressive: !doProgressive,
    onBitmap: (result) => {
      // 静默丢弃：slot 已不在 DOM 或已离开视口很远
      if (!slot.isConnected) {
        try { result.bitmap.close() } catch {}
        return
      }
      // 已达页面的 token 变更 → 这张图已过时
      if (slot.dataset.renderedToken && result.phase === 'full') {
        try { result.bitmap.close() } catch {}
        return
      }
      applySlotBitmap(slot, result)
      const ms = Math.round(performance.now() - t0)
      if (result.phase === 'full') {
        slot.dataset.renderedToken = String(token)
        slot.dataset.rendering = 'false'
        __renderedPages.add(pageNum)
        console.log('[pdf-wasm-v2] slot rendered', pageNum, 'ms=', ms)
      } else {
        console.log('[pdf-wasm-v2] slot low-res', pageNum, 'ms=', ms)
      }
    },
  })

  // 异步文字层（只对初始页做）
  if (!slot.dataset.textLoading && doProgressive) {
    slot.dataset.textLoading = 'true'
    loadSlotTextLayer(slot, pageNum, coordinator, docId, scale, serverTextUrlTemplate)
  }
}

// Module-level rendered pages set (shared across PdfPreviewWASM instances for perf tracking)
const __renderedPages = new Set<number>()

function applySlotBitmap(slot: HTMLElement, result: { bitmap: ImageBitmap; width: number; height: number; phase: string }) {
  if (result.phase === 'full') {
    const existing = slot.querySelector('.pdf-canvas')
    if (existing) existing.remove()
  }

  slot.style.width = `${result.width}px`
  slot.style.height = `${result.height}px`

  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  canvas.className = 'pdf-canvas'
  canvas.style.width = `${result.width}px`
  canvas.style.height = `${result.height}px`

  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(result.bitmap, 0, 0)

  // Keep text layer if exists
  const textLayer = slot.querySelector('.pdf-textlayer')
  const skeleton = slot.querySelector('.page-skeleton')
  if (skeleton) skeleton.remove()

  // Replace only canvas, keep text layer
  const oldCanvas = slot.querySelector('.pdf-canvas')
  if (oldCanvas) oldCanvas.remove()
  if (textLayer) {
    slot.insertBefore(canvas, textLayer)
  } else {
    slot.appendChild(canvas)
  }
}

async function loadSlotTextLayer(
  slot: HTMLElement,
  pageNum: number,
  coordinator: ReturnType<typeof getCoordinator>,
  docId: number,
  scale: number,
  serverTextUrlTemplate?: string,
) {
  try {
    let textHtml = ''

    if (serverTextUrlTemplate) {
      const textUrl = serverTextUrlTemplate.replace(/n=N/, `n=${pageNum}`)
      const resp = await fetch(textUrl)
      if (resp.ok) {
        const raw = await resp.text()
        const open = raw.indexOf('>')
        const close = raw.lastIndexOf('</div>')
        if (open >= 0 && close > open) textHtml = raw.slice(open + 1, close)
      }
    }

    if (!textHtml) {
      const textResult = await coordinator.requestTextExtract(docId, pageNum, scale)
      textHtml = buildTextLayerFromCharBoxes(textResult.positions, textResult.chars, textResult.pageW, textResult.pageH)
    }

    if (!textHtml) return

    const textLayer = document.createElement('div')
    textLayer.className = 'pdf-textlayer'
    textLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:auto;cursor:text;user-select:text'
    textLayer.innerHTML = textHtml

    // scaleX 对齐（复用 PdfImagesPreview 的 pattern）
    applyScaleXAlignment(textLayer)

    slot.appendChild(textLayer)
  } catch (e) {
    console.warn('[pdf-wasm-v2] text-layer failed page=', pageNum, e)
  }
}

function applyScaleXAlignment(textLayer: HTMLElement) {
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    (document as any).fonts.ready.then(() => applyScaleXNow(textLayer))
  } else {
    requestAnimationFrame(() => applyScaleXNow(textLayer))
  }
}

function applyScaleXNow(textLayer: HTMLElement) {
  const spans = textLayer.querySelectorAll('span')
  for (const span of Array.from(spans)) {
    const el = span as HTMLElement
    const text = el.textContent || ''
    if (text.length < 1) continue

    let inkWidth = parseFloat(el.style.width)
    if (!inkWidth || inkWidth < 2) {
      const cached = el.dataset.inkW
      if (cached) inkWidth = parseFloat(cached)
    }
    if (!inkWidth || inkWidth < 2) continue

    el.dataset.inkW = String(inkWidth)
    el.style.transform = ''
    el.style.transformOrigin = ''
    el.style.width = ''

    let browserWidth = el.getBoundingClientRect().width
    if (!browserWidth) browserWidth = el.scrollWidth || 0
    if (browserWidth < 1) continue

    const sx = inkWidth / browserWidth
    if (Math.abs(sx - 1) > 0.001) {
      el.style.transform = `scaleX(${sx.toFixed(4)})`
      el.style.transformOrigin = '0% 0%'
    }
  }
}

// ============ 工具栏 ============

function RenderedCount() {
  const n = usePerf(s => s.renderedPages || __renderedPages.size)
  return <>{n}</>
}