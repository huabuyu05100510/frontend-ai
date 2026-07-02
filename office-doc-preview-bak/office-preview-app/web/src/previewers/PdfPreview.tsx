import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { usePerf, tickMemory } from '../perf'

// pdf.js worker：v4 是 ES module，必须用 type:'module'。
let workerStatus = 'init'
function ensureWorker() {
  if (workerStatus !== 'init') return
  try {
    const w = new Worker(PdfWorkerUrl, { type: 'module' })
    w.onerror = () => { workerStatus = 'fallback' }
    pdfjsLib.GlobalWorkerOptions.workerPort = w
    workerStatus = 'ok'
  } catch (e) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''
    workerStatus = 'fallback'
  }
}

interface Props { url: string; docSize?: number }

const DEFAULT_W = 714
const DEFAULT_H = 1010
const BUFFER_PAGES = 2

type Phase = 'loading' | 'ready' | 'error'

export function PdfPreview({ url, docSize = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const sizesRef = useRef<Map<number, { w: number; h: number }>>(new Map())
  const rendersRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map())
  const pagesRef = useRef<Map<number, pdfjsLib.PDFPageProxy>>(new Map())
  const tokenRef = useRef(0)

  const [phase, setPhase] = useState<Phase>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.2)

  const st = usePerf.getState()

  // 加载文档
  useEffect(() => {
    let cancelled = false
    tokenRef.current++
    sizesRef.current.clear()
    ensureWorker()
    setPhase('loading'); setErrMsg(''); setPageCount(0)
    st.set({ docUrl: url, docSize, pages: 0, downloaded: 0, tParseMs: 0, tFirstPageMs: 0, renderedPages: 0, tLoadStart: performance.now() })

    const loadingTask = pdfjsLib.getDocument({
      url, rangeChunkSize: 262144, disableRange: false, disableAutoFetch: true, disableStream: false
    })
    loadingTask.onProgress = ({ loaded }: { loaded: number; total: number }) => {
      usePerf.getState().set({ downloaded: loaded, pages: pdfRef.current?.numPages || 0 })
    }
    loadingTask.promise.then(async (pdf) => {
      if (cancelled) { pdf.destroy(); return }
      pdfRef.current = pdf
      usePerf.getState().set({ pages: pdf.numPages, tParseMs: Math.round(performance.now() - st.tLoadStart) })
      setPageCount(pdf.numPages)
      setPhase('ready')
    }).catch(err => { if (!cancelled) { setErrMsg(String(err?.message || err)); setPhase('error') } })

    return () => {
      cancelled = true
      for (const r of rendersRef.current.values()) { try { r.cancel() } catch {} }
      rendersRef.current.clear()
      pdfRef.current?.destroy(); pdfRef.current = null
    }
  }, [url])

  // 渲染单页（命令式）
  const renderPageInto = useCallback(async (pageNum: number, slot: HTMLElement, token: number) => {
    const pdf = pdfRef.current
    if (!pdf) return
    if (slot.dataset.renderedToken === String(token)) return
    const t0 = performance.now()
    try {
      if (!sizesRef.current.has(pageNum)) {
        const p0 = await pdf.getPage(pageNum)
        if (token !== tokenRef.current) return
        const vp0 = p0.getViewport({ scale })
        sizesRef.current.set(pageNum, { w: vp0.width, h: vp0.height })
        slot.style.width = `${Math.floor(vp0.width)}px`
        slot.style.height = `${Math.floor(vp0.height)}px`
      }
      const page = await pdf.getPage(pageNum)
      if (token !== tokenRef.current) return
      pagesRef.current.set(pageNum, page)
      const viewport = page.getViewport({ scale })
      const dpr = 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      canvas.className = 'pdf-canvas'
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const textLayer = document.createElement('div')
      textLayer.className = 'pdf-textlayer'
      textLayer.style.width = `${Math.floor(viewport.width)}px`
      textLayer.style.height = `${Math.floor(viewport.height)}px`
      slot.dataset.renderedToken = String(token)
      slot.style.width = `${Math.floor(viewport.width)}px`
      slot.style.height = `${Math.floor(viewport.height)}px`

      canvas.style.display = 'none'
      const renderTask = page.render({ canvasContext: ctx, viewport })
      rendersRef.current.set(pageNum, renderTask)
      await renderTask.promise.catch(() => {})
      rendersRef.current.delete(pageNum)
      if (token !== tokenRef.current) return
      slot.textContent = ''
      slot.appendChild(canvas)
      canvas.style.display = 'block'
      slot.appendChild(textLayer)

      const s = usePerf.getState()
      s.set({ renderedPages: s.renderedPages + 1, lastRenderMs: Math.round(performance.now() - t0) })
      if (s.renderedPages === 1) s.set({ tFirstPageMs: Math.round(performance.now() - s.tLoadStart) })

      // 文本层（可选中/可搜索）
      try {
        const textContent = await page.getTextContent()
        if (token !== tokenRef.current) return
        const frag = document.createDocumentFragment()
        for (const item of textContent.items as any[]) {
          const span = document.createElement('span')
          const tr = pdfjsLib.Util.transform(viewport.transform, item.transform)
          span.style.left = `${tr[4]}px`
          span.style.top = `${tr[5] - (item.height || 0) * scale}px`
          span.style.fontSize = `${(item.height || 10) * scale}px`
          span.textContent = item.str
          frag.appendChild(span)
        }
        textLayer.appendChild(frag)
      } catch {}
    } catch {}
  }, [scale])

  // 视口虚拟化 + 可见页优先
  useEffect(() => {
    if (phase !== 'ready' || pageCount === 0) return
    const el = containerRef.current
    if (!el) return
    const myToken = tokenRef.current
    const observer = new IntersectionObserver((entries) => {
      const ins = entries.filter(e => e.isIntersecting).map(e => {
        const rect = e.boundingClientRect
        const dist = Math.abs((rect.top + rect.bottom) / 2 - el.clientHeight / 2)
        return { slot: e.target as HTMLElement, pageNum: Number((e.target as HTMLElement).dataset.page), dist }
      }).sort((a, b) => a.dist - b.dist)
      for (const { slot, pageNum } of ins) renderPageInto(pageNum, slot, myToken)
      for (const entry of entries) {
        if (entry.isIntersecting) continue
        const slot = entry.target as HTMLElement
        const pageNum = Number(slot.dataset.page)
        const r = rendersRef.current.get(pageNum)
        if (r) { try { r.cancel() } catch {}; rendersRef.current.delete(pageNum) }
        const cached = pagesRef.current.get(pageNum)
        if (cached) { try { cached.cleanup() } catch {}; pagesRef.current.delete(pageNum) }
        if (slot.dataset.renderedToken) {
          slot.innerHTML = '<div class="page-skeleton"></div>'
          delete slot.dataset.renderedToken
        }
      }
    }, { root: el, rootMargin: `${BUFFER_PAGES * 600}px 0px`, threshold: 0 })
    el.querySelectorAll<HTMLElement>('[data-page]').forEach(s => observer.observe(s))
    const firstSlot = el.querySelector<HTMLElement>('[data-page="1"]')
    if (firstSlot) renderPageInto(1, firstSlot, myToken)
    return () => observer.disconnect()
  }, [phase, pageCount, renderPageInto])

  // 缩放（去抖）
  const scaleTimer = useRef<any>(null)
  const zoom = (delta: number) => {
    setScale(s => {
      const next = Math.max(0.5, Math.min(3, +(s + delta).toFixed(2)))
      if (next === s) return s
      clearTimeout(scaleTimer.current)
      scaleTimer.current = setTimeout(() => {
        tokenRef.current++
        sizesRef.current.clear()
        usePerf.getState().set({ renderedPages: 0 })
        const el = containerRef.current
        el?.querySelectorAll<HTMLElement>('[data-page]').forEach(sl => {
          sl.style.width = `${DEFAULT_W}px`; sl.style.height = `${DEFAULT_H}px`
          sl.innerHTML = '<div class="page-skeleton"></div>'
          delete sl.dataset.renderedToken
        })
      }, 150)
      return next
    })
  }

  useEffect(() => { const t = setInterval(tickMemory, 2000); tickMemory(); return () => clearInterval(t) }, [])
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let last = el.scrollTop, lastT = performance.now()
    const onScroll = () => {
      const now = performance.now()
      usePerf.getState().set({ scrollVel: Math.round((Math.abs(el.scrollTop - last) / (now - lastT)) * 1000) })
      last = el.scrollTop; lastT = now
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll as any)
  }, [phase])

  return (
    <div className="pdf-root">
      <div className="pdf-toolbar">
        <span>共 {pageCount} 页 · 已渲染 <RenderedCount/> · worker:{workerStatus}</span>
        <div className="spacer" />
        <button className="btn-mini" onClick={() => zoom(-0.2)}>−</button>
        <span className="scale-text">{Math.round(scale * 100)}%</span>
        <button className="btn-mini" onClick={() => zoom(0.2)}>＋</button>
      </div>
      <div className="pdf-container" ref={containerRef}>
        {phase === 'loading' && <div className="center-msg">解析 PDF 中…</div>}
        {phase === 'error' && <div className="center-msg err">加载失败：{errMsg}</div>}
        {phase === 'ready' && (
          <div className="pdf-pages">
            {Array.from({ length: pageCount }, (_, i) => (
              <div className="pdf-slot" data-page={i + 1} key={i + 1} style={{ width: DEFAULT_W, height: DEFAULT_H }}>
                <div className="page-skeleton" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RenderedCount() {
  const n = usePerf(s => s.renderedPages)
  return <>{n}</>
}
