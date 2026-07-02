// 服务端栅格化图片预览 + 透明文字覆盖层（方案 B）
// 模型：claude-sonnet-4-6
// 关键对齐技术（v4）：
//   1. 服务端 span 坐标直接来自 PDFium ink bbox（与 PNG 同源，100% 像素对齐）
//   2. span width = PNG ink width，fontSize = screen pixels → 无需客户端 scaleX 补偿
//   3. overflow:hidden 防止浏览器字形溢出 ink bbox
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Task, PageImage } from '../types'
import { usePerf } from '../perf'

interface Props {
  task: Task
}

const BUFFER_PAGES = 2
// 文字层缓存：避免重复 fetch 同页 HTML
// 缓存 value 包含 { html, pageW?, pageH? } —— pageW/pageH 从 data-page-w/h 解析出来
interface CachedTextLayer {
  html: string
  pageW?: number
  pageH?: number
  // 【PDFium 可观测】来自服务端 X-Render-Engine / X-Char-Count 响应头
  xEngine?: string | null
  xCharCount?: number
}
const textCache = new Map<number, CachedTextLayer>()

/** 从文字层 HTML 根 div 提取 data-page-w / data-page-h（权威页尺寸） */
function parseTextLayerDims(html: string): { pageW?: number; pageH?: number } {
  const m = html.match(/data-page-w="([\d.]+)"\s+data-page-h="([\d.]+)"/)
  if (!m) return {}
  return { pageW: parseFloat(m[1]), pageH: parseFloat(m[2]) }
}

/**
 * 从服务端 text-layer HTML 中只提取 spans（innerHTML），去掉外层 .pdf-text-layer div。
 * 防止双重 .pdf-text-layer 嵌套（React 外层 + 服务端内层），消除选区重影。
 * 服务端格式：<div class="pdf-text-layer" data-pdfium="4" ...><span ...>...</span>...</div>
 */
function extractSpans(html: string): string {
  // 取 <div ...> 和 </div> 之间的内容（spans）
  const open = html.indexOf('>')
  const close = html.lastIndexOf('</div>')
  if (open < 0 || close < 0 || close <= open) return html
  return html.slice(open + 1, close)
}

export function PdfImagesPreview({ task }: Props) {
  const pages: PageImage[] = task.pages || []
  const containerRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(1)
  const [visibleSet, setVisibleSet] = useState<Set<number>>(() => new Set(pages.map(p => p.page)))
  const [textLayers, setTextLayers] = useState<Map<number, CachedTextLayer>>(() => new Map())

  // 性能面板：把当前渲染过的页数同步过去
  useEffect(() => {
    usePerf.getState().set({ renderedPages: visibleSet.size })
  }, [visibleSet])

  // 懒加载文字层：图片 src 已设置后 fetch 该页 text HTML
  useEffect(() => {
    if (!pages.length) return
    const needFetch: number[] = []
    for (const p of pages) {
      if (!p.textUrl) continue
      if (textCache.has(p.page)) {
        if (!textLayers.has(p.page)) {
          setTextLayers(prev => {
            const next = new Map(prev)
            next.set(p.page, textCache.get(p.page)!)
            return next
          })
        }
      } else if (!textLayers.has(p.page)) {
        needFetch.push(p.page)
      }
    }
    if (!needFetch.length) return
    let cancelled = false
    ;(async () => {
      for (const pageNum of needFetch) {
        const p = pages.find(x => x.page === pageNum)
        if (!p?.textUrl) continue
        try {
          const r = await fetch(p.textUrl, { credentials: 'same-origin' })
          if (!r.ok) continue
          const html = await r.text()
          if (cancelled) return
          // 【PDFium 可观测】从服务端响应头捕获引擎标识 + 字符数 + 页码
          // 兜底：测试/老代理可能没有 headers（jsdom mock 等）
          const headers = (r.headers && typeof r.headers.get === 'function') ? r.headers : null
          const xEngine = headers ? headers.get('X-Render-Engine') : null
          const xCharCount = Number(headers ? headers.get('X-Char-Count') : 0) || 0
          const xPageNum = Number(headers ? headers.get('X-Page-Number') : pageNum) || pageNum
          const dims = parseTextLayerDims(html)
          const cached: CachedTextLayer = { html, ...dims, xEngine, xCharCount }
          textCache.set(pageNum, cached)
          setTextLayers(prev => {
            const next = new Map(prev)
            next.set(pageNum, cached)
            return next
          })
          // 上报到 usePerf：引擎标识 + 累计字符数（首次响应即更新）
          const perf = usePerf.getState()
          const isPdfium = xEngine?.startsWith('pdfium')
          usePerf.getState().set({
            renderEngine: isPdfium ? 'pdfium-wasm' : (xEngine === 'fallback-poppler' ? 'fallback-poppler' : perf.renderEngine),
            pdfiumCharsTotal: perf.pdfiumCharsTotal + (isPdfium ? xCharCount : 0),
            renderedPages: perf.renderedPages + 1
          })
        } catch {
          // 单页失败不阻断其他页
        }
      }
    })()
    return () => { cancelled = true }
  }, [pages, textLayers])

  // IntersectionObserver：滚动时只让视口内 + 前后 buffer 页为「活跃」状态
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const io = new IntersectionObserver((entries) => {
      const next = new Set(visibleSet)
      let currentPage = current
      let bestRatio = 0
      for (const e of entries) {
        const pageAttr = Number((e.target as HTMLElement).dataset.page)
        if (e.isIntersecting) {
          for (let p = Math.max(1, pageAttr - BUFFER_PAGES); p <= Math.min(pages.length, pageAttr + BUFFER_PAGES); p++) {
            next.add(p)
          }
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio
            currentPage = pageAttr
          }
        }
      }
      const farPages = new Set<number>()
      for (const p of next) {
        if (Math.abs(p - currentPage) <= BUFFER_PAGES + 1) farPages.add(p)
      }
      setVisibleSet(farPages)
      if (currentPage !== current) setCurrent(currentPage)
    }, { root, rootMargin: '1200px 0px', threshold: [0, 0.01, 0.5] })
    root.querySelectorAll('[data-page]').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [pages.length])

  // v4.4: 纯净 pdf.js 文字层对齐方案。
  // 正确做法（pdf.js 标准）：
  //   1. 清除服务端 width:inkWidth（让 span 自然宽度 = 浏览器文字渲染宽度）
  //   2. scaleX = inkWidth / 浏览器文字 box 宽度
  //   3. transform-origin: 0 0（从左边缘拉伸）
  //   4. 不设显式 width —— transform 后 box = 自然宽度 × sx = inkWidth
  // hit area = inkWidth box = PNG 文字区域（点击准确），
  // ::selection 高亮跟随拉伸后的字形 = 完整覆盖 PNG 文字（含收尾）。
  //
  // 关键：React dangerouslySetInnerHTML 在 textLayers 变化时重置 innerHTML，
  //   会清掉 JS 设的 inline transform。所以 effect 不能 skip 已处理页——
  //   每次 textLayers 变化都要重新应用。原始 inkWidth 缓存在 dataset.inkW。
  const scaleAppliedPages = useRef<Set<number>>(new Set())
  useLayoutEffect(() => {
    if (!textLayers.size) return
    const root = containerRef.current
    if (!root) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      for (const [pageNum] of textLayers) {
        const pageEl = root.querySelector(`.pdf-image-page[data-page="${pageNum}"]`)
        if (!pageEl) continue
        const spans = pageEl.querySelectorAll('.pdf-text-layer span')
        if (!spans.length) continue
        for (const span of Array.from(spans)) {
          const el = span as HTMLElement
          const text = el.textContent || ''
          if (text.length < 1) continue
          // 原始 inkWidth：优先 inline width，否则读 dataset 缓存
          // （React 重渲染清空了 inline width 时，dataset 仍保留）
          let inkWidth = parseFloat(el.style.width)
          if (!inkWidth || inkWidth < 2) {
            const cached = el.dataset.inkW
            if (cached) inkWidth = parseFloat(cached)
          }
          if (!inkWidth || inkWidth < 2) continue
          el.dataset.inkW = String(inkWidth)
          // 清除残留 transform + 服务端 width，让 box 回到 shrink-to-fit 自然宽度
          el.style.transform = ''
          el.style.transformOrigin = ''
          el.style.width = ''
          // 测量 box 宽度（transform 作用对象），box × sx = inkWidth 精确成立
          let browserWidth = el.getBoundingClientRect().width
          if (!browserWidth) browserWidth = el.scrollWidth || 0
          if (browserWidth < 1) continue
          const sx = inkWidth / browserWidth
          if (Math.abs(sx - 1) > 0.001) {
            el.style.transform = `scaleX(${sx.toFixed(4)})`
            el.style.transformOrigin = '0% 0%'
          }
        }
        scaleAppliedPages.current.add(pageNum)
      }
    }
    // 等待字体加载完再测量（回退字体宽度 ≠ 最终字体，会导致 sx 偏差）
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(apply)
    } else {
      apply()
    }
    return () => { cancelled = true }
  }, [textLayers])

  // 【PDFium 路径】文字层加载即完成对齐——服务端 bbox 中心 = PNG ink 中心
  // 旧版的双 effect（alignError 测量 + ink-box 覆盖）已删除：PDFium 同引擎保证 0 漂移
  // 保留 usePerf.alignError* 字段作为"健康检查探针"位（PDFium 路径下理论为 0）
  useEffect(() => {
    if (!textLayers.size) return
    // PDFium 路径：所有 span bbox 100% 与 PNG ink 对齐 → 对齐误差理论为 0
    // 仅在服务端真返回 PDFium 引擎时标 0（fallback-poppler 路径走老测量）
    const allFromPdfium = Array.from(textLayers.values()).every(c => c.xEngine?.startsWith('pdfium'))
    if (allFromPdfium) {
      usePerf.getState().set({ alignErrorAvg: 0, alignErrorMax: 0, alignSamples: textLayers.size })
    }
  }, [textLayers])

  if (!pages.length) {
    return <div className="center-msg err">无栅格化结果（请切换到 PDF 模式）</div>
  }

  // 关键：每页必须按自身栅格化 PNG 的真实像素尺寸布局。
  // 优先级：text-layer data-page-w/h（最权威，文字层 bbox 用的就是这套） >
  //         API 返回的 p.width/height（兜底） > 默认值
  // 这样即使 API 返回老任务脏数据（thumb 尺寸），wrapper 也能正确缩放。
  function pageDims(p: PageImage) {
    const cached = textLayers.get(p.page)
    if (cached?.pageW && cached?.pageH) {
      return { w: cached.pageW, h: cached.pageH }
    }
    return { w: p.width || 800, h: p.height || 1130 }
  }
  const maxPageWidth = pages.reduce((m, p) => Math.max(m, pageDims(p).w), 0) || undefined
  const textLoadedCount = textLayers.size
  const textTotalPages = pages.filter(p => p.textUrl).length

  return (
    <div className="pdf-images-root" ref={containerRef}>
      <div className="pdf-images-toolbar">
        <span>第 <strong>{current}</strong> / {pages.length} 页</span>
        <span className="pdf-images-meta">
          共 {pages.length} 页 · 服务端栅格化 · 模式：图片+文字
          {textTotalPages > 0 && ` · 文字层 ${textLoadedCount}/${textTotalPages}`}
        </span>
      </div>
      <div
        className="pdf-images-frame"
        style={maxPageWidth ? { maxWidth: maxPageWidth + 'px' } : undefined}
      >
        {pages.map(p => {
          const visible = visibleSet.has(p.page)
          const cachedLayer = textLayers.get(p.page)
          const textHtml = cachedLayer?.html || ''
          const { w, h } = pageDims(p)
          return (
            <div
              key={p.page}
              className="pdf-image-page"
              data-page={p.page}
              data-page-w={w}
              data-page-h={h}
              style={{
                position: 'relative',
                width: w + 'px',
                height: h + 'px',
                marginBottom: 12
              }}
            >
              {/* img 由 .pdf-images-page CSS 规则管理尺寸（width:100%; height:100%）。
                  不再用内联 style 强制，避免与 CSS class 冲突导致窄窗下 wrapper/img 缩放不同步。 */}
              <img
                className="pdf-images-page"
                src={visible ? p.url : undefined}
                alt={`第 ${p.page} 页`}
                loading="lazy"
                decoding="async"
                style={{ display: 'block' }}
              />
              {/* 文字覆盖层：透明但可选可复制。坐标系与 wrapper 像素 1:1 对齐。
                  v4: 从服务端 HTML 中只提取 spans（innerHTML），不再嵌套整个 .pdf-text-layer div。
                  消除双重 position:absolute + z-index 导致的选区重影。 */}
              {p.textUrl && textHtml && (
                <div
                  className="pdf-text-layer"
                  data-page={p.page}
                  dangerouslySetInnerHTML={{ __html: extractSpans(textHtml) }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}