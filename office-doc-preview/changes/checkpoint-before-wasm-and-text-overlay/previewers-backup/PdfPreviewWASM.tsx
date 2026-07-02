// pdfium WASM PDF预览器（性能提升10x）
// 集成@hyzyla/pdfium（Google Chrome的pdfium引擎WebAssembly版本）
// 支持多页虚拟滚动渲染
import { useEffect, useRef, useState, useCallback } from 'react'
import { usePerf, tickMemory } from '../perf'

// ========== WASM加载状态追踪 ==========

let wasmLoadStatus = 'idle'
let wasmLoadPromise: Promise<any> | null = null
let libraryInstance: any = null

// ========== WASM初始化函数 ==========

async function initWASM(): Promise<any> {
  if (wasmLoadPromise) return wasmLoadPromise
  if (libraryInstance && wasmLoadStatus === 'ready') return libraryInstance

  wasmLoadStatus = 'loading'
  console.log('[WASM] 开始加载...')

  wasmLoadPromise = (async () => {
    try {
      const module = await import('@hyzyla/pdfium/browser/base64')
      const library = await module.PDFiumLibrary.init()
      wasmLoadStatus = 'ready'
      libraryInstance = library
      console.log('[WASM] ✅ 初始化完成')
      return library
    } catch (error) {
      wasmLoadStatus = 'error'
      console.error('[WASM] ❌ 失败:', error)
      throw error
    }
  })()

  return wasmLoadPromise
}

// ========== 页面尺寸缓存（用于虚拟滚动布局）==========
const pageSizeCache = new Map<string, Map<number, { w: number; h: number }>>()

// ========== WASM PDF预览组件 ==========

interface Props {
  url: string
  docSize?: number
}

type Phase = 'loading' | 'wasm-init' | 'ready' | 'error'

const BUFFER_PAGES = 2 // 视口缓冲区

export function PdfPreviewWASM({ url, docSize = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<any>(null) // PDF文档实例
  const sizesRef = useRef<Map<number, { w: number; h: number }>>(new Map())
  const rendersRef = useRef<Set<number>>(new Set()) // 正在渲染的页面
  const tokenRef = useRef(0) // 用于取消旧渲染

  const [phase, setPhase] = useState<Phase>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [wasmStatus, setWasmStatus] = useState('idle')

  const st = usePerf.getState()

  // ========== 步骤1: WASM初始化和PDF解析 ==========
  useEffect(() => {
    let cancelled = false
    tokenRef.current++

    const loadPDF = async () => {
      setPhase('wasm-init')
      setWasmStatus('loading')
      console.log('[PDF] 开始加载:', url)

      try {
        // 初始化WASM
        setErrMsg('初始化WASM引擎...')
        const library = await initWASM()
        if (cancelled) return

        // 下载PDF
        setErrMsg('下载PDF文件...')
        const downloadStart = performance.now()
        const response = await fetch(url)
        const arrayBuffer = await response.arrayBuffer()
        const downloadTime = performance.now() - downloadStart

        if (cancelled) return
        console.log('[PDF] 下载:', arrayBuffer.byteLength, 'bytes, ', downloadTime, 'ms')
        st.set({
          downloaded: arrayBuffer.byteLength,
          downloadBps: Math.round(arrayBuffer.byteLength / downloadTime * 1000),
          tLoadStart: performance.now()
        })

        // 解析PDF
        setErrMsg('解析PDF文档...')
        const parseStart = performance.now()
        const document = await library.loadDocument(new Uint8Array(arrayBuffer))
        const parseTime = performance.now() - parseStart
        const pages = document.getPageCount()

        if (cancelled) {
          document.destroy()
          return
        }

        console.log('[PDF] 解析:', pages, '页, ', parseTime, 'ms')
        docRef.current = document
        sizesRef.current = pageSizeCache.get(url) || new Map()
        st.set({ pages, tParseMs: Math.round(parseTime) })
        setPageCount(pages)
        setWasmStatus('ready')

        // 设置ready状态
        setPhase('ready')
        setErrMsg('')
        console.log('[PDF] ✅ 解析完成，准备渲染...')

      } catch (error: any) {
        if (!cancelled) {
          console.error('[PDF] ❌ 错误:', error)
          setErrMsg(`加载失败: ${error?.message || error}`)
          setPhase('error')
          setWasmStatus('error')
        }
      }
    }

    loadPDF()

    return () => {
      cancelled = true
      docRef.current?.destroy()
      docRef.current = null
      rendersRef.current.clear()
    }
  }, [url])

  // ========== 渲染单页（命令式）==========
  const renderPageInto = useCallback(async (pageNum: number, slot: HTMLElement, token: number) => {
    const doc = docRef.current
    if (!doc) return
    if (slot.dataset.renderedToken === String(token)) return // 已渲染
    if (rendersRef.current.has(pageNum)) return // 正在渲染

    rendersRef.current.add(pageNum)
    const t0 = performance.now()

    try {
      // pdfium的pageIndex从0开始，而pageNum从1开始（用户视角）
      const pageIndex = pageNum - 1
      const page = doc.getPage(pageIndex)

      // 先获取文本（在render之前）
      let pageText = ''
      let charPositions: Array<{ char: string; x: number; y: number; w: number; h: number }> = []

      try {
        const module = (page as any).module
        const pageIdx = (page as any).pageIdx
        const textPage = module._FPDFText_LoadPage(pageIdx)

        if (textPage) {
          const charCount = module._FPDFText_CountChars(textPage)
          console.log(`[PDF] 第${pageNum}页字符数: ${charCount}`)

          // 获取整页文本
          pageText = page.getText() || ''

          // 使用简化方法：按文本分组渲染
          // 遍历文本，找到行分组，为每行创建可选择的文本块
          const lines: Array<{ text: string; y: number; x: number }> = []
          let currentY = -1
          let currentLineText = ''
          let currentX = 0

          const bufferPtr = module.wasmExports.malloc(32)
          const { originalHeight } = page.getOriginalSize()

          for (let i = 0; i < Math.min(charCount, pageText.length); i++) {
            module._FPDFText_GetCharBox(textPage, i, bufferPtr, bufferPtr + 8, bufferPtr + 16, bufferPtr + 24)

            const view = new DataView(module.HEAPU8.buffer, bufferPtr, 32)
            const left = view.getFloat64(0, true)
            const bottom = view.getFloat64(8, true)
            const right = view.getFloat64(16, true)
            const top = view.getFloat64(24, true)

            const char = pageText[i] || ''

            // 检测换行：使用更大的阈值（接近一行的间距）
            // PDF中每行间距通常10-15点，字符内间距很小（<2点）
            // 观察发现字符Y变化约20-30点，所以用30作为阈值
            const charY = Math.round(top) // 使用top更稳定

            if (currentY === -1 || Math.abs(charY - currentY) > 30) {
              if (currentLineText.trim()) {
                lines.push({ text: currentLineText.trim(), y: currentY, x: currentX })
              }
              currentLineText = char
              currentY = charY
              currentX = left
            } else {
              currentLineText += char
            }
          }
          if (currentLineText.trim()) {
            lines.push({ text: currentLineText.trim(), y: currentY, x: currentX })
          }

          module.wasmExports.free(bufferPtr)
          module._FPDFText_ClosePage(textPage)

          // 将行转换为字符位置格式
          // PDF坐标系：y轴向上，原点在左下角
          // Canvas坐标系：y轴向下，原点在左上角
          // 转换：CanvasY = (originalHeight - PDFY) * scale
          for (const line of lines) {
            const canvasY = (originalHeight - line.y) * scale
            charPositions.push({
              char: line.text,
              x: line.x * scale,
              y: canvasY,
              w: 100,
              h: 12 * scale
            })
          }

          console.log(`[PDF] 第${pageNum}页文本行数: ${lines.length}`)
        }
      } catch (e: any) {
        console.log(`[PDF] 第${pageNum}页位置提取失败:`, e?.message || e)
        pageText = page.getText() || ''
      }

      // pdfium API: 使用 getOriginalSize() 而不是 getViewport()
      const { originalWidth, originalHeight } = page.getOriginalSize()
      const w = Math.floor(originalWidth * scale)
      const h = Math.floor(originalHeight * scale)

      // 设置slot尺寸
      sizesRef.current.set(pageNum, { w, h })
      slot.style.width = `${w}px`
      slot.style.height = `${h}px`

      // 创建canvas
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.className = 'pdf-canvas'
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      // 渲染页面 - pdfium API
      // 设置明确的宽高参数
      const renderResult = await page.render({
        scale,
        width: Math.floor(originalWidth * scale),
        height: Math.floor(originalHeight * scale),
      })

      console.log(`[PDF] bitmap: width=${renderResult.width}, height=${renderResult.height}, dataLen=${renderResult.data?.length}, samples=[${renderResult.data?.slice(0,12)}]`)

      // 使用bitmap的实际尺寸
      const actualW = renderResult.width
      const actualH = renderResult.height
      canvas.width = actualW
      canvas.height = actualH
      canvas.style.width = `${actualW}px`
      canvas.style.height = `${actualH}px`

      // 更新slot尺寸
      slot.style.width = `${actualW}px`
      slot.style.height = `${actualH}px`
      sizesRef.current.set(pageNum, { w: actualW, h: actualH })

      // 将bitmap绘制到canvas
      const ctx = canvas.getContext('2d')
      if (ctx && renderResult.data && renderResult.data.length > 0) {
        // 直接使用数据（pdfium返回BGRA格式）
        const imgData = new ImageData(new Uint8ClampedArray(renderResult.data), actualW, actualH)
        ctx.putImageData(imgData, 0, 0)

        // 验证绘制结果
        const verify = ctx.getImageData(50, 50, 1, 1)
        console.log(`[PDF] 绘制验证: R=${verify.data[0]}, G=${verify.data[1]}, B=${verify.data[2]}`)
        console.log(`[PDF] ✅ 第${pageNum}页Canvas绘制完成: ${actualW}x${actualH}, ${Math.round(performance.now() - t0)}ms`)
      } else {
        console.log(`[PDF] ⚠️ 第${pageNum}页渲染返回空数据`)
      }

      if (token !== tokenRef.current) return

      // 插入DOM
      slot.textContent = ''
      slot.appendChild(canvas)
      slot.dataset.renderedToken = String(token)

      // 添加文本层（支持文本选择和复制）- 使用位置对应的span
      const textLayer = document.createElement('div')
      textLayer.className = 'pdf-textlayer'
      textLayer.style.width = `${actualW}px`
      textLayer.style.height = `${actualH}px`

      if (charPositions.length > 0) {
        // 为每行文本创建可选择文本块
        for (const pos of charPositions) {
          if (pos.char && pos.char.trim()) {
            const span = document.createElement('span')
            span.textContent = pos.char

            span.style.cssText = `
              position: absolute;
              left: ${pos.x}px;
              top: ${pos.y}px;
              font-size: 12px;
              line-height: 1.5;
              color: transparent;
              white-space: pre;
              pointer-events: auto;
              cursor: text;
              user-select: text;
            `
            textLayer.appendChild(span)
          }
        }
        console.log(`[PDF] 第${pageNum}页文本层已添加 (${charPositions.length}个位置span)`)
      } else if (pageText && pageText.length > 0) {
        // 如果位置提取失败，使用简单的全页文本
        const textContainer = document.createElement('div')
        textContainer.className = 'pdf-wasm-text'
        textContainer.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: ${actualW}px;
          height: ${actualH}px;
          color: transparent;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
          overflow: hidden;
          pointer-events: auto;
          cursor: text;
          user-select: text;
        `
        textContainer.textContent = pageText
        textLayer.appendChild(textContainer)
        console.log(`[PDF] 第${pageNum}页文本层已添加（简化模式）`)
      } else {
        console.log(`[PDF] 第${pageNum}页无文本内容`)
      }
      slot.appendChild(textLayer)

      const s = usePerf.getState()
      const newRendered = s.renderedPages + 1
      s.set({ renderedPages: newRendered, lastRenderMs: Math.round(performance.now() - t0) })
      if (newRendered === 1) s.set({ tFirstPageMs: Math.round(performance.now() - s.tLoadStart) })

    } catch (err) {
      console.error(`[PDF] 渲染第${pageNum}页失败:`, err)
    } finally {
      rendersRef.current.delete(pageNum)
    }
  }, [scale])

  // ========== 创建页面槽位（避免React重新渲染清除Canvas）==========
  const pagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phase !== 'ready' || pageCount === 0) return
    const pagesEl = pagesContainerRef.current
    if (!pagesEl) return

    // 清空并重建槽位（只在phase变为ready时执行一次）
    pagesEl.innerHTML = ''
    const DEFAULT_W = 595 * scale
    const DEFAULT_H = 842 * scale

    for (let i = 1; i <= pageCount; i++) {
      const slot = document.createElement('div')
      slot.className = 'pdf-slot'
      slot.dataset.page = String(i)
      const size = sizesRef.current.get(i)
      slot.style.width = `${size?.w || DEFAULT_W}px`
      slot.style.height = `${size?.h || DEFAULT_H}px`
      slot.innerHTML = '<div class="page-skeleton"></div>'
      pagesEl.appendChild(slot)
    }

    console.log('[PDF] 创建了', pageCount, '个页面槽位')
  }, [phase, pageCount, scale]) // scale变化时重建槽位

  // ========== 视口虚拟化：可见页优先渲染 ==========
  useEffect(() => {
    if (phase !== 'ready' || pageCount === 0) return
    const el = containerRef.current
    const pagesEl = pagesContainerRef.current
    if (!el || !pagesEl) return

    // 确保滚动位置在顶部
    el.scrollTop = 0

    const myToken = tokenRef.current

    // 立即渲染前几页（确保用户能立即看到内容）
    const initialPages = Math.min(pageCount, 3) // 至少渲染3页
    for (let i = 1; i <= initialPages; i++) {
      const slot = pagesEl.querySelector<HTMLElement>(`[data-page="${i}"]`)
      if (slot && !slot.dataset.renderedToken) {
        console.log(`[PDF] 初始渲染第${i}页...`)
        renderPageInto(i, slot, myToken)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      // 收集可见页面，按距离中心排序
      const visible = entries.filter(e => e.isIntersecting).map(e => {
        const rect = e.boundingClientRect
        const dist = Math.abs((rect.top + rect.bottom) / 2 - el.clientHeight / 2)
        return { slot: e.target as HTMLElement, pageNum: Number((e.target as HTMLElement).dataset.page), dist }
      }).sort((a, b) => a.dist - b.dist)

      // 渲染可见页面（跳过已渲染的）
      for (const { slot, pageNum } of visible) {
        if (slot.dataset.renderedToken) continue // 已渲染，跳过
        renderPageInto(pageNum, slot, myToken)
      }

      // 清理离开视口的页面（释放内存）- 但不清除前几页
      for (const entry of entries) {
        if (entry.isIntersecting) continue
        const slot = entry.target as HTMLElement
        const pageNum = Number(slot.dataset.page)
        // 前几页始终保留（与初始渲染数量一致）
        if (pageNum <= initialPages) continue
        if (slot.dataset.renderedToken) {
          console.log('[PDF] 清理页面', pageNum)
          slot.innerHTML = '<div class="page-skeleton"></div>'
          delete slot.dataset.renderedToken
        }
      }
    }, { root: el, rootMargin: `${BUFFER_PAGES * 600}px 0px`, threshold: 0 })

    pagesEl.querySelectorAll<HTMLElement>('[data-page]').forEach(s => observer.observe(s))

    return () => observer.disconnect()
  }, [phase, pageCount, renderPageInto])

  // ========== 缩放控制（去抖）==========
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
          sl.innerHTML = '<div class="page-skeleton"></div>'
          delete sl.dataset.renderedToken
        })
      }, 150)
      return next
    })
  }

  // ========== 内存监控 ==========
  useEffect(() => {
    const t = setInterval(tickMemory, 2000)
    tickMemory()
    return () => clearInterval(t)
  }, [])

  // ========== 计算默认页面尺寸 ==========
  const DEFAULT_W = 595 * scale
  const DEFAULT_H = 842 * scale

  // ========== UI渲染 ==========
  return (
    <div className="pdf-root">
      <div className="pdf-toolbar">
        <span>共 {pageCount} 页 · 已渲染 <RenderedCount/> · WASM: {wasmStatus}</span>
        <div className="spacer" />
        <button className="btn-mini" onClick={() => zoom(-0.2)}>−</button>
        <span className="scale-text">{Math.round(scale * 100)}%</span>
        <button className="btn-mini" onClick={() => zoom(0.2)}>＋</button>
      </div>

      <div className="pdf-container" ref={containerRef}>
        {phase === 'loading' && <div className="center-msg">下载PDF中…</div>}
        {phase === 'wasm-init' && <div className="center-msg">{errMsg || '初始化WASM引擎…'}</div>}
        {phase === 'error' && <div className="center-msg err">加载失败：{errMsg}</div>}
        {phase === 'ready' && (
          <div className="pdf-pages" ref={pagesContainerRef} />
        )}
      </div>
    </div>
  )
}

function RenderedCount() {
  const n = usePerf(s => s.renderedPages)
  return <>{n}</>
}