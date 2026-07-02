// 双栏原文件布局对比 — 左右各显示完整文档渲染（图片+文字层）+ 差异高亮
// 模型：claude-sonnet-4-6
//
// 架构：
//   - 每页一行（CSS Grid），左图+右图配对，单滚动容器 → 天然同步
//   - 复用 PdfImagesPreview 的页面渲染模式：<img> + .pdf-text-layer overlay
//   - 文字层 span 上叠加差异高亮（通过 charOps 文本匹配策略）
//
// 当 task 有 pages 时使用此组件；无 pages 时 fallback 到纯文本 DualColumnView

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react'
import type { Task, InspectDiffResponse, DiffOp } from '../types'

interface Props {
  source: Task
  compare: Task
  diff: InspectDiffResponse | null
}

/** 从 PDFium 文字层 HTML 提取 spans（去掉外层 div） */
function extractSpans(html: string): string {
  const open = html.indexOf('>')
  const close = html.lastIndexOf('</div>')
  if (open < 0 || close < 0 || close <= open) return html
  return html.slice(open + 1, close)
}

/**
 * 从 charOps 构建差异文本查找表
 * 返回 { deleteTexts: string[], insertTexts: string[], pairMap: Map<number, {op:'delete'|'insert', text}> }
 * pairIdx = delete/insert 序号（第 N 个 delete ↔ 第 N 个 insert 配对）
 */
function buildDiffLookup(charOps?: DiffOp[]) {
  const deleteTexts: string[] = []
  const insertTexts: string[] = []
  const pairMap = new Map<number, { op: 'delete' | 'insert', text: string }>()
  let delIdx = 0
  let insIdx = 0
  if (!charOps) return { deleteTexts, insertTexts, pairMap }
  for (const op of charOps) {
    if (op.op === 'delete') {
      deleteTexts.push(op.text)
      pairMap.set(delIdx++, { op: 'delete', text: op.text })
    } else if (op.op === 'insert') {
      insertTexts.push(op.text)
      pairMap.set(insIdx++, { op: 'insert', text: op.text })
    }
  }
  return { deleteTexts, insertTexts, pairMap }
}

/**
 * 检查 span 文本是否包含某个 diff 文本（前缀/全量匹配）
 * 返回匹配的 pairIdx 或 -1
 */
function findDiffMatch(spanText: string, texts: string[]): number {
  const trimmed = spanText.trim()
  for (let i = 0; i < texts.length; i++) {
    if (trimmed === texts[i].trim() || trimmed.startsWith(texts[i].trim())) return i
  }
  return -1
}

export function DualImageColumn({ source, compare, diff }: Props) {
  const srcPages = source.pages || []
  const cmpPages = compare.pages || []
  const maxPages = Math.max(srcPages.length, cmpPages.length)

  // 文字层缓存：{ `${side}:${pageNum}` → { html, pageW, pageH } }
  const [textLayers, setTextLayers] = useState<Map<string, { html: string; pageW?: number; pageH?: number }>>(() => new Map())

  // 差异查找表（从 paragraphBlocks 的 charOps 构建）
  // 取第一个 change block 的 charOps 作为全局差异标注依据
  const firstChangeBlock = diff?.paragraphBlocks?.find(b => b.kind === 'change')
  const { deleteTexts, insertTexts } = buildDiffLookup(firstChangeBlock?.charOps)

  // change 段落索引列表（用于导航）
  const changeIdxList = (diff?.paragraphBlocks || [])
    .map((b, i) => b.kind !== 'equal' ? i : -1)
    .filter(i => i >= 0)

  // 联动高亮状态
  const [hoveredPairIdx, setHoveredPairIdx] = useState<number | null>(null)

  // 懒加载文字层（左/右分别缓存）
  useEffect(() => {
    type FetchTask = { side: 'left' | 'right'; page: number; textUrl: string }
    const tasks: FetchTask[] = []
    srcPages.forEach(p => { if (p.textUrl) tasks.push({ side: 'left', page: p.page, textUrl: p.textUrl! }) })
    cmpPages.forEach(p => { if (p.textUrl) tasks.push({ side: 'right', page: p.page, textUrl: p.textUrl! }) })
    const needFetch = tasks.filter(t => !textLayers.has(`${t.side}:${t.page}`))
    if (!needFetch.length) return
    let cancelled = false
    ;(async () => {
      for (const t of needFetch) {
        try {
          const r = await fetch(t.textUrl, { credentials: 'same-origin' })
          if (!r.ok) continue
          const html = await r.text()
          if (cancelled) return
          const wMatch = html.match(/data-page-w="([\d.]+)"/)
          const hMatch = html.match(/data-page-h="([\d.]+)"/)
          const cached = { html, pageW: wMatch ? parseFloat(wMatch[1]) : undefined, pageH: hMatch ? parseFloat(hMatch[1]) : undefined }
          const key = `${t.side}:${t.page}`
          setTextLayers(prev => { const next = new Map(prev); next.set(key, cached); return next })
        } catch { /* 单页失败不阻断 */ }
      }
    })()
    return () => { cancelled = true }
  }, [srcPages, cmpPages])

  // 文字层加载后应用差异高亮 + scaleX 对齐
  const containerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!textLayers.size || !containerRef.current) return
    const root = containerRef.current
    if (!root) return

    // 对左侧 spans 应用 delete 高亮
    for (const [key, { html: _html }] of textLayers) {
      const [side, pageStr] = key.split(':')
      const pageNum = parseInt(pageStr, 10)
      const cell = root.querySelector(`.dic-page-cell[data-side="${side}"][data-page="${pageNum}"]`)
      if (!cell) continue
      const spans = cell.querySelectorAll('.pdf-text-layer span')
      const targets = side === 'left' ? deleteTexts : insertTexts
      const cls = side === 'left' ? 'dic-diff-delete' : 'dic-diff-insert'

      for (const span of Array.from(spans)) {
        const el = span as HTMLElement
        const txt = el.textContent || ''
        if (txt.length < 1) continue
        const matchIdx = findDiffMatch(txt, targets)
        if (matchIdx >= 0) {
          el.classList.add(cls)
          el.dataset.pairIdx = String(matchIdx)
        }
      }
    }
  }, [textLayers])

  // v4.4 scaleX 对齐（复用 PdfImagesPreview 方案）
  const scaleApplied = useRef<Set<string>>(new Set())
  useLayoutEffect(() => {
    if (!textLayers.size) return
    const root = containerRef.current
    if (!root) return
    for (const [key] of textLayers) {
      const [side, pageStr] = key.split(':')
      const pageNum = parseInt(pageStr, 10)
      const cell = root.querySelector(`.dic-page-cell[data-side="${side}"][data-page="${pageNum}"]`)
      if (!cell) continue
      const spans = cell.querySelectorAll('.pdf-text-layer span')
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
        const bw = el.getBoundingClientRect().width
        if (bw < 1) continue
        const sx = inkWidth / bw
        if (Math.abs(sx - 1) > 0.001) {
          el.style.transform = `scaleX(${sx.toFixed(4)})`
          el.style.transformOrigin = '0% 0%'
        }
      }
      scaleApplied.current.add(key)
    }
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        /* re-apply after fonts loaded */
      })
    }
  }, [textLayers])

  // 首次加载自动选中第一个 change block
  useEffect(() => {
    if (!diff) return
    const blocks = diff.paragraphBlocks || []
    const firstChangeIdx = blocks.findIndex(b => b.kind !== 'equal')
    if (firstChangeIdx >= 0) setHoveredPairIdx(firstChangeIdx)
  }, [diff])

  const gotoChange = useCallback((delta: number) => {
    if (!diff) return
    if (changeIdxList.length === 0) return
    const curIdx = hoveredPairIdx !== null ? changeIdxList.indexOf(hoveredPairIdx) : -1
    const nextIdx = Math.max(0, Math.min(changeIdxList.length - 1, curIdx + delta))
    setHoveredPairIdx(changeIdxList[nextIdx])
    setTimeout(() => {
      const el = document.querySelector(`.dic-page-row[data-pair-idx="${changeIdxList[nextIdx]}"]`)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 0)
  }, [diff, hoveredPairIdx, changeIdxList])

  if (!maxPages) {
    return <div className="icm-msg">无栅格化内容</div>
  }

  const changeCount = changeIdxList.length

  return (
    <div className="dic-scroll-container" data-testid="dual-image-column">
      {/* 导航栏 */}
      {changeCount > 0 && (
        <div className="dcv-navbar">
          <button type="button" className="dcv-nav-btn" onClick={() => gotoChange(-1)} disabled={hoveredPairIdx === null || changeIdxList.indexOf(hoveredPairIdx) <= 0}>
            ↑ 上一处
          </button>
          <span className="dcv-nav-count">
            {hoveredPairIdx !== null ? `第 ${changeIdxList.indexOf(hoveredPairIdx) + 1} / ${changeCount} 处差异` : `共 ${changeCount} 处差异`}
          </span>
          <button type="button" className="dcv-nav-btn" onClick={() => gotoChange(1)} disabled={hoveredPairIdx === null || changeIdxList.indexOf(hoveredPairIdx) >= changeCount - 1}>
            ↓ 下一处
          </button>
        </div>
      )}

      {/* 页面网格 */}
      <div className="dic-page-grid" data-testid="dual-image-grid" ref={containerRef}>
        <div className="dic-colhdr" data-testid="dic-left-hd">原文</div>
        <div className="dic-colhdr dic-colhdr-right" data-testid="dic-right-hd">目标</div>

        {Array.from({ length: maxPages }, (_, idx) => {
          const srcPage = srcPages[idx]
          const cmpPage = cmpPages[idx]
          const srcLayer = textLayers.get(`left:${idx}`)
          const cmpLayer = textLayers.get(`right:${idx}`)

          // 左侧 cell
          const leftHasContent = !!srcPage
          const leftW = srcLayer?.pageW || srcPage?.width || 800
          const leftH = srcLayer?.pageH || srcPage?.height || 1130

          // 右侧 cell
          const rightHasContent = !!cmpPage
          const rightW = cmpLayer?.pageW || cmpPage?.width || 800
          const rightH = cmpLayer?.pageH || cmpPage?.height || 1130
          // 行高取两侧较大值，保证内容不被裁剪
          const rowH = Math.max(leftH, rightH)

          return (
            <div
              key={idx}
              className="dic-page-row"
              data-pair-idx={idx}
              style={{ minHeight: `${rowH}px` }}
            >
              {/* 左侧 */}
              <div
                className={`dic-page-cell ${!leftHasContent ? 'dic-page-empty' : ''}`}
                data-side="left"
                data-page={idx}
                style={{ width: `${leftW}px`, height: `${leftH}px` }}
              >
                {leftHasContent && (
                  <>
                    <img
                      className="dic-page-img"
                      src={srcPage.url}
                      alt={`第 ${idx + 1} 页`}
                      loading="lazy"
                      decoding="async"
                    />
                    {srcLayer?.html && (
                      <div
                        className="pdf-text-layer"
                        data-page={idx}
                        dangerouslySetInnerHTML={{ __html: extractSpans(srcLayer.html) }}
                      />
                    )}
                  </>
                )}
              </div>

              {/* 右侧 */}
              <div
                className={`dic-page-cell ${!rightHasContent ? 'dic-page-empty dic-page-empty-right' : ''}`}
                data-side="right"
                data-page={idx}
                style={{ width: `${rightW}px`, height: `${rightH}px` }}
              >
                {rightHasContent && (
                  <>
                    <img
                      className="dic-page-img"
                      src={cmpPage.url}
                      alt={`第 ${idx + 1} 页`}
                      loading="lazy"
                      decoding="async"
                    />
                    {cmpLayer?.html && (
                      <div
                        className="pdf-text-layer"
                        data-page={idx}
                        dangerouslySetInnerHTML={{ __html: extractSpans(cmpLayer.html) }}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
