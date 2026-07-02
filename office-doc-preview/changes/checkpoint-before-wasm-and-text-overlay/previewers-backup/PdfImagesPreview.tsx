// 服务端栅格化图片预览：直接渲染 <img> 列表，浏览器零成本
// 优势：相比 pdf.js 渲染，PDF 含 7713px 大图时首屏从 15s 降到 <1s
// 模型：Claude MiniMax-M3（MiniMax）
import { useEffect, useRef, useState } from 'react'
import type { Task, PageImage } from '../types'
import { usePerf } from '../perf'

interface Props {
  task: Task
}

const BUFFER_PAGES = 2

export function PdfImagesPreview({ task }: Props) {
  const pages: PageImage[] = task.pages || []
  const containerRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(1)
  const [visibleSet, setVisibleSet] = useState<Set<number>>(() => new Set(pages.map(p => p.page)))
  const renderedRef = useRef(0)

  // 性能面板：把当前渲染过的页数同步过去
  useEffect(() => {
    renderedRef.current = visibleSet.size
    usePerf.getState().set({ renderedPages: visibleSet.size })
  }, [visibleSet])

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
          // 计算 buffer 范围
          for (let p = Math.max(1, pageAttr - BUFFER_PAGES); p <= Math.min(pages.length, pageAttr + BUFFER_PAGES); p++) {
            next.add(p)
          }
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio
            currentPage = pageAttr
          }
        }
      }
      // 远离视口的页面从 set 中移除（释放浏览器解码缓存）
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

  if (!pages.length) {
    return <div className="center-msg err">无栅格化结果（请切换到 PDF 模式）</div>
  }

  // 用第一页宽度作为容器最大宽度参考（保持比例）
  const firstWidth = pages[0]?.width || 800
  const firstHeight = pages[0]?.height || 1130

  return (
    <div className="pdf-images-root" ref={containerRef}>
      <div className="pdf-images-toolbar">
        <span>第 <strong>{current}</strong> / {pages.length} 页</span>
        <span className="pdf-images-meta">共 {pages.length} 页 · 服务端栅格化 · 模式：图片</span>
      </div>
      <div
        className="pdf-images-frame"
        style={{ maxWidth: firstWidth + 'px', aspectRatio: `${firstWidth} / ${firstHeight}` }}
      >
        {pages.map(p => {
          const visible = visibleSet.has(p.page)
          return (
            <img
              key={p.page}
              className="pdf-images-page"
              data-page={p.page}
              src={visible ? p.url : undefined}
              srcSet={visible ? undefined : undefined}
              alt={`第 ${p.page} 页`}
              loading="lazy"
              decoding="async"
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                marginBottom: 12
              }}
            />
          )
        })}
      </div>
    </div>
  )
}