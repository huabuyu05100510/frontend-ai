// 翻译双栏对照 — 双语阅读模式（按页对照 + 右栏 on-demand 渲染）
// 模型：claude-sonnet-4-6
//
// 设计要点（v5.0 双滚动条 + 滚动联动 + hover 联动）：
//   1. **双滚动条**：左（原文）和右（译文）各有独立 overflow-y: scroll 容器
//   2. **滚动联动**：任一侧滚动时，另一侧自动同步到对应页位置（page-offset 映射）
//   3. **hover 联动**：悬停原文/译文字符，对侧对应字符同步高亮（DOM 直接操作，零 React re-render）
//   4. **WASM 修复**：WASM 模式仅左侧（原文）走 pdfium canvas；右侧（译文）始终走 server images 管线
//   5. **按需渲染**：右 cell 进入视口才拉取图片+文字层；带 LRU 内存缓存
//
// 数据流：
//   /api/inspect/translate              → { pages: [{page, sourceText, targetText, ...}], ... }
//                                          ↓
//   TranslationLayout 渲染（左/右各自独立滚动）
//                                          ↓ (右 cell 视口相交)
//   /api/inspect/translate/render-image?taskId=...&page=N&targetLang=...
//   /api/inspect/translate/render-text?taskId=...&page=N&targetLang=...
//                                          ↓
//   <img> + <div class="pdf-text-layer">  → 与左 cell PDF 图+文字层同款

import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { useStore } from '../store'
import { usePerf } from '../perf'
import type { LangCode, TranslateResponse, TranslatePage, Task, PageImage, TranslateRenderMode } from '../types'

// v4.2：WASM 模式懒加载 pdfium 渲染器（仅左侧原文用）
const PdfPreviewWASM = lazy(() => import('../previewers/PdfPreviewWASM').then(m => ({ default: m.PdfPreviewWASM })))
// v4.3：单页 WASM 渲染（翻译用，按页对应 + 共享 doc 缓存）
import { PdfPageWASM } from '../previewers/PdfPageWASM'

const LANG_OPTIONS: { code: LangCode; label: string }[] = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
]

/** 内存 LRU 缓存：pageRenderCache: key → { imageUrl, textHtml, pageW, pageH, status, ms } */
type CachedRender = { imageUrl: string; textHtml: string; pageW: number; pageH: number; status: 'loading' | 'ready' | 'error'; error?: string; ms: number }
const pageRenderCache = new Map<string, CachedRender>()
const CACHE_MAX = 64

function cacheGet(key: string): CachedRender | undefined {
  const v = pageRenderCache.get(key)
  if (v) {
    pageRenderCache.delete(key)
    pageRenderCache.set(key, v) // LRU
  }
  return v
}
function cacheSet(key: string, val: CachedRender) {
  if (pageRenderCache.has(key)) pageRenderCache.delete(key)
  pageRenderCache.set(key, val)
  while (pageRenderCache.size > CACHE_MAX) {
    const first = pageRenderCache.keys().next().value
    if (first) pageRenderCache.delete(first)
  }
}

/** 测试辅助：清空 pageRenderCache（仅在 beforeEach 中调用） */
export function __resetPageRenderCacheForTest() {
  pageRenderCache.clear()
  sourceTextLayerCache.clear()
}

// ── 源文档文字层缓存 + 注释工具 ────────────────────────────────────────────────

/** 源文档文字层 HTML 缓存（key: `${taskId}:${pageNum}` → annotated HTML） */
const sourceTextLayerCache = new Map<string, string>()

/** 解析 span style 中的一个数值属性（如 left/top/width/height/font-size） */
function parsePx(style: string, key: string): number {
  const m = style.match(new RegExp(key + ':([\\d.]+)px'))
  return m ? parseFloat(m[1]) : 0
}

/**
 * 把 pdfium v4 text-layer HTML 的 run-level spans 拆成 char-level spans，
 * 每个字符独占一个 span，位置按等分比例计算，打上 data-src-idx-start / data-src-idx-end。
 *
 * 精度提升（对比 run-level）：
 *   - run span 覆盖整行/词 → 选中时高亮整行
 *   - char span 宽度 = runWidth / charCount → 选中时只高亮对应字符
 *
 * v5.3：比例宽度（CJK 全角=2单位，ASCII 半角=1单位），解决中英混排定位偏移。
 *       同时修复 fallback 倒退匹配导致的 hover 错位问题。
 */

/** CJK 全角字符判断（含中日韩统一汉字、全角标点、假名等） */
function isCJKChar(c: string): boolean {
  const code = c.charCodeAt(0)
  return (
    (code >= 0x2E80 && code <= 0x9FFF) ||  // CJK Radicals / Unified Ideographs
    (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility
    (code >= 0xFF00 && code <= 0xFFEF) ||  // Fullwidth ASCII / Halfwidth Katakana
    (code >= 0x3000 && code <= 0x303F) ||  // CJK Symbols and Punctuation
    (code >= 0x3040 && code <= 0x30FF)     // Hiragana / Katakana
  )
}

/** 按字符宽度比例计算各字符左边距和宽度（CJK=2单位，ASCII=1单位） */
function proportionalCharWidths(chars: string[], totalWidth: number): { charLefts: number[]; charWidths: number[] } {
  const units = chars.map(c => (isCJKChar(c) ? 2 : 1))
  const totalUnits = units.reduce((a, b) => a + b, 0)
  const unitW = totalUnits > 0 ? totalWidth / totalUnits : totalWidth / chars.length
  const charWidths = units.map(u => u * unitW)
  const charLefts: number[] = []
  let acc = 0
  for (const w of charWidths) { charLefts.push(acc); acc += w }
  return { charLefts, charWidths }
}

/**
 * 找最佳匹配位置：全局扫描所有出现位置，选最接近 pos 的。
 * 前向距离正常计算，后向距离 2× 惩罚（优先前向，但允许合理回退以处理 PDF 列乱序）。
 * Fix v5.4：替代原来的 indexOf+20字符回退，解决两列 PDF pdfium 按列乱序导出时的 hover 错位。
 */
function findBestPosition(text: string, sourceText: string, pos: number): number {
  if (!text) return -1
  const occs: number[] = []
  let from = 0, idx: number
  while ((idx = sourceText.indexOf(text, from)) >= 0) {
    occs.push(idx)
    from = idx + 1
  }
  if (occs.length === 0) return -1
  return occs.reduce((best, occ) => {
    const da = occ >= pos ? occ - pos : (pos - occ) * 2
    const db = best >= pos ? best - pos : (pos - best) * 2
    return da < db ? occ : best
  })
}

function annotateSourceTextLayer(html: string, sourceText: string): string {
  try {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      'text/html'
    )
    const layer = doc.querySelector('.pdf-text-layer')
    if (!layer) return html

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    let pos = 0
    const newSpans: string[] = []
    // data-line-idx: 按视觉行（top 坐标）分组，避免 pdfium 单段落大 span 导致一次高亮整段
    const lineIdxMap = new Map<number, number>()
    let nextLineIdx = 0

    for (const span of layer.querySelectorAll('span')) {
      const text = span.textContent || ''
      if (!text) { newSpans.push(span.outerHTML); continue }

      const style = span.getAttribute('style') || ''
      const left = parsePx(style, 'left')
      const top = parsePx(style, 'top')
      const width = parsePx(style, 'width')
      const height = parsePx(style, 'height') || 12
      const fontSize = parsePx(style, 'font-size') || 12

      const chars = [...text]

      // v5.4：findBestPosition 全局最优匹配，解决两列 PDF pdfium 乱序导出问题
      const found = findBestPosition(text, sourceText, pos)

      if (found >= 0) {
        const { charLefts, charWidths } = proportionalCharWidths(chars, width)
        chars.forEach((ch, i) => {
          const cLeft = (left + charLefts[i]).toFixed(2)
          const cW = charWidths[i].toFixed(2)
          const srcIdx = found + i
          // data-line-idx: 按视觉行（rounded top）分组，hover 单行精确
          const charTop = Math.round(top)
          if (!lineIdxMap.has(charTop)) lineIdxMap.set(charTop, nextLineIdx++)
          const lineIdx = lineIdxMap.get(charTop)!
          newSpans.push(
            `<span data-src-idx-start="${srcIdx}" data-src-idx-end="${srcIdx + 1}" data-line-idx="${lineIdx}" style="position:absolute;left:${cLeft}px;top:${top.toFixed(2)}px;width:${cW}px;height:${height.toFixed(2)}px;font-size:${fontSize.toFixed(2)}px">${esc(ch)}</span>`
          )
        })
        if (found >= pos) pos = found + chars.length
      } else {
        // 无法匹配：保留原 span（不打 data-line-idx，hover 不覆盖）
        newSpans.push(span.outerHTML)
      }
    }

    const w = layer.getAttribute('data-page-w') || ''
    const h = layer.getAttribute('data-page-h') || ''
    return `<div class="pdf-text-layer" data-pdfium="4" data-page-w="${w}" data-page-h="${h}">${newSpans.join('')}</div>`
  } catch (e) {
    console.warn('[source-text-layer] annotate failed', e)
    return html
  }
}

// ── 滚动联动工具函数 ──────────────────────────────────────────────────────────

/** 构建每页顶部累计偏移量数组（单位 px） */
function buildPageOffsets(pageHeights: number[], gap: number): number[] {
  const offsets = [0]
  for (const h of pageHeights) {
    offsets.push(offsets[offsets.length - 1] + h + gap)
  }
  return offsets
}

/**
 * 基于 page-offset 映射把 scrollTop 从 fromOffsets 映射到 toOffsets。
 * 找到当前所在页及页内比例，然后对应到目标面板的同页位置。
 */
function mapScrollPos(scrollTop: number, fromOffsets: number[], toOffsets: number[]): number {
  if (fromOffsets.length <= 1) return scrollTop
  // 二分找当前页
  let lo = 0, hi = fromOffsets.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (fromOffsets[mid] <= scrollTop) lo = mid
    else hi = mid - 1
  }
  const pi = lo
  const fromH = Math.max(1, (fromOffsets[pi + 1] ?? fromOffsets[pi] + 1000) - fromOffsets[pi])
  const ratio = Math.min(1, (scrollTop - fromOffsets[pi]) / fromH)
  const toStart = toOffsets[pi] ?? 0
  const toH = Math.max(1, (toOffsets[pi + 1] ?? toStart + fromH) - toStart)
  return toStart + ratio * toH
}

// ── 右栏单页渲染（始终走 server images 管线，不再走 pdf/wasm source） ───────

/**
 * 右栏单页渲染：拉取图片 + 文字层，懒加载 + LRU 缓存
 * v5.0：移除 pdf/wasm early-return，目标侧始终使用 server 渲染图片
 */
function TranslatedPage({
  taskId, pageNum, targetLang, sourceLang, paperScale, cellW, cellH,
  onHoverSrcIdx, strategy,
}: {
  taskId: string
  pageNum: number
  targetLang: LangCode
  sourceLang: LangCode
  paperScale: number
  cellW: number
  cellH: number
  onHoverSrcIdx: (idx: number | null) => void
  strategy?: 'passthrough' | 'synthetic'
}) {
  const cacheKey = `${strategy || 'synthetic'}:${taskId}:${pageNum}:${targetLang}`
  const [rendered, setRendered] = useState<CachedRender | undefined>(() => cacheGet(cacheKey))
  const [inView, setInView] = useState(false)
  const cellRef = useRef<HTMLDivElement>(null)

  // IntersectionObserver：进入视口才开始拉取
  useEffect(() => {
    const el = cellRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true)
            obs.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // 触发拉取
  useEffect(() => {
    if (!inView) return
    const cached = cacheGet(cacheKey)
    if (cached && cached.status === 'ready') { setRendered(cached); return }
    if (cached && cached.status === 'loading') { setRendered(cached); return }
    const placeholder: CachedRender = { imageUrl: '', textHtml: '', pageW: 0, pageH: 0, status: 'loading', ms: 0 }
    cacheSet(cacheKey, placeholder)
    setRendered(placeholder)

    const t0 = performance.now()
    const strategyParam = strategy ? `&strategy=${strategy}` : ''
    Promise.all([
      fetch(`/api/inspect/translate/render-image?taskId=${encodeURIComponent(taskId)}&page=${pageNum}&sourceLang=${sourceLang}&targetLang=${targetLang}${strategyParam}`, { credentials: 'same-origin' })
        .then(async r => {
          if (!r.ok) throw new Error(`render-image ${r.status}`)
          const blob = await r.blob()
          return { url: URL.createObjectURL(blob), w: Number(r.headers.get('x-translate-page-w') || 0), h: Number(r.headers.get('x-translate-page-h') || 0), ms: Number(r.headers.get('x-translate-render-ms') || 0), cached: r.headers.get('x-translate-cached') === '1' }
        }),
      fetch(`/api/inspect/translate/render-text?taskId=${encodeURIComponent(taskId)}&page=${pageNum}&sourceLang=${sourceLang}&targetLang=${targetLang}${strategyParam}`, { credentials: 'same-origin' })
        .then(async r => {
          if (!r.ok) throw new Error(`render-text ${r.status}`)
          return r.text()
        }),
    ]).then(([img, html]) => {
      const ms = +(performance.now() - t0).toFixed(1)
      const innerHtml = html.trim()
      const final: CachedRender = {
        imageUrl: img.url,
        textHtml: innerHtml,
        pageW: img.w,
        pageH: img.h,
        status: 'ready',
        ms: img.ms || ms,
      }
      cacheSet(cacheKey, final)
      setRendered(final)
      console.info('[translate-render] ready', { pageNum, targetLang, ms, serverMs: img.ms, cached: img.cached, size: `${img.w}x${img.h}`, pdfiumVer: innerHtml.match(/data-pdfium="(\d+)"/)?.[1] })
    }).catch(e => {
      const fail: CachedRender = { imageUrl: '', textHtml: '', pageW: 0, pageH: 0, status: 'error', error: String(e?.message || e), ms: 0 }
      cacheSet(cacheKey, fail)
      setRendered(fail)
      console.error('[translate-render] failed', { pageNum, targetLang, error: fail.error })
    })
  }, [inView, cacheKey, taskId, pageNum, targetLang, sourceLang])

  // 切语言后重新拉取
  useEffect(() => {
    if (rendered && rendered.status === 'ready') {
      setRendered(undefined)
      setInView(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLang])

  // v5.0 hover 联动：右 cell 文字层（带 data-src-idx）→ onHoverSrcIdx 触发双栏高亮
  // 用 mouseover/mouseout 委托，支持动态注入的 DOM
  useEffect(() => {
    const el = cellRef.current
    if (!el) return
    const findSpan = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) return null
      return target.closest('[data-src-idx]') as HTMLElement | null
    }
    const handleEnter = (e: Event) => {
      const span = findSpan(e.target)
      if (!span) return
      const idx = Number(span.getAttribute('data-src-idx'))
      if (Number.isFinite(idx) && idx >= 0) {
        onHoverSrcIdx(idx)
      }
    }
    const handleLeave = (e: Event) => {
      const span = findSpan(e.target)
      if (!span) return
      const related = (e as MouseEvent).relatedTarget as Node | null
      if (!related || !el.contains(related)) {
        onHoverSrcIdx(null)
      }
    }
    el.addEventListener('mouseover', handleEnter)
    el.addEventListener('mouseout', handleLeave)
    return () => {
      el.removeEventListener('mouseover', handleEnter)
      el.removeEventListener('mouseout', handleLeave)
    }
  }, [rendered, onHoverSrcIdx])

  return (
    <div
      ref={cellRef}
      className={`ttl-page-paper ttl-page-paper-tgt ${rendered?.status === 'loading' ? 'is-loading' : ''} ${rendered?.status === 'error' ? 'is-error' : ''}`}
      data-testid={`translate-tgt-page-${pageNum}`}
      data-status={rendered?.status || 'pending'}
      style={{ width: `${cellW}px`, height: `${cellH}px`, transform: `scale(${paperScale})`, transformOrigin: 'top left' }}
    >
      {rendered?.status === 'ready' && (
        <>
          <img
            className="ttl-page-img"
            src={rendered.imageUrl}
            alt={`译文第 ${pageNum} 页`}
            loading="lazy"
            decoding="async"
          />
          {rendered.textHtml && (
            <div
              className="pdf-text-layer"
              data-page={pageNum}
              dangerouslySetInnerHTML={{ __html: rendered.textHtml }}
            />
          )}
        </>
      )}
      {rendered?.status === 'loading' && (
        <div className="ttl-page-loading">
          <div className="loading-spinner" />
          <div>渲染中…</div>
        </div>
      )}
      {rendered?.status === 'error' && (
        <div className="ttl-page-error">
          <div>渲染失败：{rendered.error}</div>
          <button type="button" className="btn-mini" onClick={() => {
            pageRenderCache.delete(cacheKey)
            setRendered(undefined)
            setInView(false)
          }}>重试</button>
        </div>
      )}
    </div>
  )
}

// ── 源文档单页（图片 + 文字层覆盖，替代 embed/wasm 裸渲染） ──────────────────

/**
 * 源文档单页：渲染图片（或 WASM canvas）并叠加可选文字层。
 * v5.1：
 *   - 图片模式 / WASM 模式统一走此组件
 *   - 从 /api/files/:taskId?as=text&n=N 按需拉取 pdfium v4 文字层
 *   - annotateSourceTextLayer 打上 data-src-idx-start/end，支持选区联动
 *   - PDF embed 模式废弃（embed 无法限定单页，在双栏中显示整本文档）
 */
function SourcePage({
  taskId, pageNum, pageW, pageH, scale, sourceText,
  imageUrl, usePdfWasm, pdfUrl, onHoverSrcIdx,
}: {
  taskId: string
  pageNum: number
  pageW: number
  pageH: number
  scale: number
  sourceText: string
  imageUrl: string | null
  usePdfWasm: boolean
  pdfUrl: string
  onHoverSrcIdx: (idx: number | null) => void
}) {
  const [textHtml, setTextHtml] = useState<string | null>(null)

  // 拉取 + 注释源文字层（txt/md 无服务端文字层，跳过）
  useEffect(() => {
    if (!imageUrl && !usePdfWasm) return
    const key = `${taskId}:${pageNum}`
    const cached = sourceTextLayerCache.get(key)
    if (cached !== undefined) { setTextHtml(cached); return }

    fetch(`/api/files/${encodeURIComponent(taskId)}?as=text&n=${pageNum}`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)))
      .then(html => {
        const annotated = annotateSourceTextLayer(html, sourceText)
        sourceTextLayerCache.set(key, annotated)
        setTextHtml(annotated)
        console.info('[source-text-layer] loaded', { taskId, pageNum })
      })
      .catch(e => {
        console.warn('[source-text-layer] failed', { taskId, pageNum, err: e?.message })
        sourceTextLayerCache.set(key, '') // 防重复拉
      })
  }, [taskId, pageNum, sourceText, imageUrl, usePdfWasm])

  // txt/md 页：直接渲染文本，不叠文字层
  if (!imageUrl && !usePdfWasm) {
    return (
      <div
        className="ttl-page-paper"
        style={{ width: `${pageW}px`, height: `${pageH}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        <TextPage text={sourceText} onHoverSrcIdx={onHoverSrcIdx} />
      </div>
    )
  }

  return (
    <div
      className="ttl-page-paper"
      style={{ width: `${pageW}px`, height: `${pageH}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}
    >
      {usePdfWasm ? (
        <Suspense fallback={<div className="ttl-cell-loading">WASM…</div>}>
          <PdfPageWASM url={pdfUrl} pageNum={pageNum} targetW={pageW} targetH={pageH} noTextLayer />
        </Suspense>
      ) : (
        <img
          className="ttl-page-img"
          src={imageUrl!}
          alt={`原文第 ${pageNum} 页`}
          loading="lazy"
          decoding="async"
        />
      )}
      {textHtml && (
        <div
          className="pdf-text-layer"
          data-page={pageNum}
          data-side="src"
          dangerouslySetInnerHTML={{ __html: textHtml }}
        />
      )}
    </div>
  )
}

/** 缩略图卡片（左侧缩略图栏） */
function ThumbCard({
  page, pageNum, isActive, onClick, sourcePage, scale,
}: {
  page: TranslatePage
  pageNum: number
  isActive: boolean
  onClick: () => void
  sourcePage?: PageImage
  scale: number
}) {
  const hasImg = !!sourcePage?.url
  const cardW = 60
  const ratio = page.pageH / page.pageW
  const cardH = Math.max(40, Math.round(cardW * ratio))
  return (
    <button
      type="button"
      className={`ttl-thumb ${isActive ? 'is-active' : ''}`}
      onClick={onClick}
      data-page={pageNum}
      data-testid={`thumb-${pageNum}`}
      title={`第 ${pageNum} 页`}
    >
      <div
        className="ttl-thumb-inner"
        style={{ width: `${cardW * scale}px`, height: `${cardH * scale}px` }}
      >
        {hasImg ? (
          <img
            src={sourcePage!.url}
            alt={`第 ${pageNum} 页`}
            loading="lazy"
            decoding="async"
            className="ttl-thumb-img"
          />
        ) : (
          <ThumbText text={page.sourceText} />
        )}
        <span className="ttl-thumb-num">{pageNum}</span>
      </div>
    </button>
  )
}

function ThumbText({ text }: { text: string }) {
  const lines = text.split('\n').slice(0, 6)
  return (
    <div className="ttl-thumb-text">
      {lines.map((l, i) => <div key={i}>{l.slice(0, 12) || '\u00A0'}</div>)}
    </div>
  )
}

/**
 * TranslationLayout props (Phase B hook for download button wiring)
 *
 * TranslationLayout was previously a no-arg function driven entirely by zustand.
 * Phase B adds an OPTIONAL `onDownload` prop so embedded callers (e.g.
 * DocTranslateStagePanel) can capture clicks on the download button. If omitted
 * the button is rendered but the click becomes a no-op — preserving the
 * existing InspectCompareModal usage.
 */
export interface TranslationLayoutProps {
  /** Optional callback for the download button. Omit for no-op behavior. */
  onDownload?: () => void
}

export function TranslationLayout(props: TranslationLayoutProps = {}) {
  const { onDownload } = props
  const source = useStore(s => s.translateSource)
  const sourceLang = useStore(s => s.translateSourceLang)
  const targetLang = useStore(s => s.translateTargetLang)
  const status = useStore(s => s.translateStatus)
  const result = useStore(s => s.translateResult)
  const error = useStore(s => s.translateError)
  const setTargetLang = useStore(s => s.setTranslateTargetLang)
  const setSourceLang = useStore(s => s.setTranslateSourceLang)
  const setStatus = useStore(s => s.setTranslateStatus)
  const setResult = useStore(s => s.setTranslateResult)
  const setError = useStore(s => s.setTranslateError)
  const renderMode = useStore(s => s.translateRenderMode)
  const setRenderMode = useStore(s => s.setTranslateRenderMode)
  // Phase A.3: 词级对比 toggle (zustand-driven，便于 DocTranslateStagePanel 读取)
  const wordDiffEnabled = useStore(s => s.translateWordDiff)
  const setWordDiff = useStore(s => s.setTranslateWordDiff)

  const [loading, setLoading] = useState(false)
  const [activePage, setActivePage] = useState(1)
  const [scale, setScale] = useState(1)
  const [thumbScale, setThumbScale] = useState(1)

  // v5.0：双滚动容器 refs
  const srcScrollRef = useRef<HTMLDivElement>(null)
  const tgtScrollRef = useRef<HTMLDivElement>(null)
  // 源面板页码 ref（用于 IntersectionObserver + scrollToPage）
  const srcPageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // 当前 pages / scale 的 ref（用于滚动联动 effect 内访问，避免 stale closure）
  const pagesRef = useRef<typeof pages>([])
  const scaleRef = useRef(scale)

  // v5.2：DOM-based hover 联动桥
  // 源侧：line-level（整个 pdfium run，via data-run-idx）
  // 目标侧：char-level（data-src-idx="N"）
  // 有活跃文本选区时不触发 hover（避免 hover+selection 叠加）
  const highlightSrcIdx = useCallback((idx: number | null) => {
    // 如果有非空选区，不触发 hover（避免叠加重影）
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && !sel.isCollapsed) return

    // Clear
    srcScrollRef.current?.querySelectorAll('.is-hover').forEach(s => s.classList.remove('is-hover'))
    tgtScrollRef.current?.querySelectorAll('.is-hover').forEach(s => s.classList.remove('is-hover'))
    if (idx === null) return

    // 源侧：visual-line-level via data-line-idx
    const srcEl = srcScrollRef.current
    if (!srcEl) return
    const pivot = srcEl.querySelector<HTMLElement>(`[data-src-idx-start="${idx}"]`)
    const lineIdx = pivot?.getAttribute('data-line-idx')

    if (lineIdx != null) {
      // v5.4 Fix：将查询范围限制在 pivot 所在页的 .pdf-text-layer，
      // 避免跨页 data-line-idx 相同（每页独立从 0 计数）导致多页同时高亮
      const pivotLayer = pivot!.closest('.pdf-text-layer') as HTMLElement | null
      const srcScope = pivotLayer || srcEl

      // Source: 高亮同视觉行（same top，限定同页）
      srcScope.querySelectorAll<HTMLElement>(`[data-line-idx="${lineIdx}"]`)
        .forEach(s => s.classList.add('is-hover'))

      // Target: 高亮对应范围 [lineStart, lineEnd)
      let lineStart = Infinity, lineEnd = -Infinity
      srcScope.querySelectorAll<HTMLElement>(`[data-line-idx="${lineIdx}"]`).forEach(s => {
        const ss = Number(s.getAttribute('data-src-idx-start'))
        const ee = Number(s.getAttribute('data-src-idx-end'))
        if (!isNaN(ss)) lineStart = Math.min(lineStart, ss)
        if (!isNaN(ee)) lineEnd = Math.max(lineEnd, ee)
      })
      if (isFinite(lineStart) && lineStart < lineEnd) {
        // 同样限定到同页的目标文字层，避免跨页误高亮
        const pageNum = pivotLayer?.getAttribute('data-page')
        const tgtEl = tgtScrollRef.current
        const tgtScope = pageNum && tgtEl
          ? (tgtEl.querySelector<HTMLElement>(`.pdf-text-layer[data-page="${pageNum}"]`) || tgtEl)
          : tgtEl
        tgtScope?.querySelectorAll<HTMLElement>('[data-src-idx]').forEach(s => {
          const i = Number(s.getAttribute('data-src-idx'))
          if (!isNaN(i) && i >= lineStart && i < lineEnd) s.classList.add('is-hover')
        })
      }
    } else {
      // Fallback: TextPage (data-src-idx on span, char-level both sides)
      srcEl.querySelectorAll<HTMLElement>(`[data-src-idx="${idx}"]`)
        .forEach(s => s.classList.add('is-hover'))
      tgtScrollRef.current?.querySelectorAll<HTMLElement>(`[data-src-idx="${idx}"]`)
        .forEach(s => s.classList.add('is-hover'))
    }
  }, [])

  // v5.1：选区联动桥（DOM-based，同 hover 桥）
  // skipSide：跳过该侧（用户在该侧选择，浏览器原生选区已提供视觉反馈，避免重影）
  const highlightBySourceRange = useCallback((
    srcStart: number, srcEnd: number, skipSide?: 'src' | 'tgt'
  ) => {
    for (const ref of [srcScrollRef, tgtScrollRef]) {
      const el = ref.current; if (!el) continue
      el.querySelectorAll('.is-selected').forEach(s => s.classList.remove('is-selected'))
    }
    // 源侧 char-level span：data-src-idx-start/end（annotateSourceTextLayer 已拆成单字）
    if (skipSide !== 'src') {
      srcScrollRef.current?.querySelectorAll<HTMLElement>('[data-src-idx-start]').forEach(span => {
        if (!span.textContent?.trim()) return // 跳过空白 span（空格/无文字区域）
        const s = Number(span.getAttribute('data-src-idx-start'))
        const e = Number(span.getAttribute('data-src-idx-end'))
        if (!isNaN(s) && !isNaN(e) && s < srcEnd && e > srcStart) span.classList.add('is-selected')
      })
      // 兼容 TextPage .ttl-char（txt/md 模式）
      srcScrollRef.current?.querySelectorAll<HTMLElement>('.ttl-char[data-src-idx]').forEach(span => {
        const idx = Number(span.getAttribute('data-src-idx'))
        if (!isNaN(idx) && idx >= srcStart && idx < srcEnd) span.classList.add('is-selected')
      })
    }
    // 目标侧 char-level span：data-src-idx ∈ [srcStart, srcEnd)
    if (skipSide !== 'tgt') {
      tgtScrollRef.current?.querySelectorAll<HTMLElement>('[data-src-idx]').forEach(span => {
        if (!span.textContent?.trim()) return // 跳过空白 span
        const idx = Number(span.getAttribute('data-src-idx'))
        if (!isNaN(idx) && idx >= srcStart && idx < srcEnd) span.classList.add('is-selected')
      })
    }
  }, [])

  // v4.1.4：复制联动
  const copySource = useCallback(async () => {
    if (!result || result.pages.length === 0) return
    const text = result.pages.map(p => p.sourceText || '').join('\n')
    try {
      await navigator.clipboard.writeText(text)
      console.info('[translate-copy] source ok, chars=', text.length)
    } catch (e) { console.error('[translate-copy] source failed:', e) }
  }, [result])

  const copyTarget = useCallback(async () => {
    if (!result || result.pages.length === 0) return
    const text = result.pages.map(p => p.targetText || '').join('\n')
    try {
      await navigator.clipboard.writeText(text)
      console.info('[translate-copy] target ok, chars=', text.length)
    } catch (e) { console.error('[translate-copy] target failed:', e) }
  }, [result])

  const copyBilingual = useCallback(async () => {
    if (!result || result.pages.length === 0) return
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const rows = result.pages.map(p =>
      `<tr><td>${esc(p.sourceText || '')}</td><td>${esc(p.targetText || '')}</td></tr>`
    ).join('')
    const html = `<table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>原文</th><th>译文</th></tr></thead><tbody>${rows}</tbody></table>`
    const plain = result.pages.map(p =>
      `${(p.sourceText || '').replace(/\t/g, ' ')}\t${(p.targetText || '').replace(/\t/g, ' ')}`
    ).join('\n')
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
      console.info('[translate-copy] bilingual ok, rows=', result.pages.length)
    } catch (e) { console.error('[translate-copy] bilingual failed:', e) }
  }, [result])

  // AI 翻译触发
  const handleTranslate = useCallback(async () => {
    if (!source) { console.warn('[translate] no source task'); return }
    setStatus('loading')
    setError(null)
    setLoading(true)
    const t0 = performance.now()
    const ext = (source.previewExt || source.ext || '').toLowerCase()
    const strategy: 'passthrough' | 'synthetic' =
      (ext === 'docx' || ext === 'pdf') ? 'passthrough' : 'synthetic'
    try {
      console.info('[translate] start', { taskId: source.id, sourceLang, targetLang, strategy, ext })
      const r = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ taskId: source.id, sourceLang, targetLang, strategy }),
      })
      if (!r.ok) {
        const errText = await r.text().catch(() => '')
        throw new Error(`translate ${r.status} ${errText.slice(0, 80)}`)
      }
      const data: TranslateResponse = await r.json()
      const t1 = performance.now()
      const ms = +(t1 - t0).toFixed(1)
      console.info('[translate] ok', { ms, segments: data.segments.length, pages: data.pages.length, srcChars: data.meta.sourceChars, tgtChars: data.meta.targetChars })
      const prev = usePerf.getState()
      usePerf.getState().set({
        translateMs: ms,
        translateSegments: data.segments.length,
        translateTotalMs: prev.translateTotalMs + ms,
        translateCount: prev.translateCount + 1,
        translateEngine: data.meta.engine,
      })
      setResult(data)
      setStatus('ready')
      setActivePage(1)
    } catch (e: any) {
      const msg = String(e?.message || e)
      console.error('[translate] failed:', msg)
      setError(msg)
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [source, sourceLang, targetLang, setError, setResult, setStatus])

  // 切语言后清空旧结果 + 清右栏缓存
  useEffect(() => {
    if (status === 'ready' && result && (result.sourceLang !== sourceLang || result.targetLang !== targetLang)) {
      console.info('[translate] lang changed, clear result')
      setResult(null)
      setStatus('idle')
      pageRenderCache.clear()
    }
  }, [sourceLang, targetLang]) // eslint-disable-line react-hooks/exhaustive-deps

  // mount 自动触发翻译
  const autoFiredRef = useRef<string | null>(null)
  useEffect(() => {
    if (!source) return
    if (autoFiredRef.current === source.id) return
    if (status !== 'idle') return
    autoFiredRef.current = source.id
    console.info('[translate] mount auto-trigger', source.id)
    handleTranslate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source?.id])

  // v4.2：是否支持 PDF / WASM 模式
  const supportsPdf = useMemo(() => {
    if (!source) return false
    if (source.previewUrl) return true
    const ext = (source.previewExt || source.ext || '').toLowerCase()
    return ext === 'pdf' || ext === 'docx' || ext === 'doc'
  }, [source])

  useEffect(() => {
    if (!supportsPdf && renderMode !== 'images') {
      console.info('[translate] render mode fallback to images (no source pdf)')
      setRenderMode('images')
    }
  }, [supportsPdf, renderMode, setRenderMode])

  const sourcePdfUrl = source?.previewUrl || source?.originalUrl || ''

  const pages = result?.pages || []

  // 同步 pagesRef / scaleRef（供滚动联动 effect 内使用）
  pagesRef.current = pages
  scaleRef.current = scale

  // v5.0：双向滚动联动（page-offset 映射，防 ping-pong）
  useEffect(() => {
    if (status !== 'ready') return
    const src = srcScrollRef.current
    const tgt = tgtScrollRef.current
    if (!src || !tgt) return

    let syncFrom: 'src' | 'tgt' | null = null
    let rafId = 0

    const makeHandler = (from: 'src' | 'tgt') => () => {
      if (syncFrom !== null && syncFrom !== from) return
      syncFrom = from
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const heights = pagesRef.current.map(p => p.pageH * scaleRef.current + 24)
        const offsets = buildPageOffsets(heights, 20)
        if (from === 'src') {
          tgt.scrollTop = mapScrollPos(src.scrollTop, offsets, offsets)
        } else {
          src.scrollTop = mapScrollPos(tgt.scrollTop, offsets, offsets)
        }
        requestAnimationFrame(() => { syncFrom = null })
      })
    }

    const onSrc = makeHandler('src')
    const onTgt = makeHandler('tgt')
    src.addEventListener('scroll', onSrc, { passive: true })
    tgt.addEventListener('scroll', onTgt, { passive: true })
    console.info('[linked-scroll] attached, pages=', pagesRef.current.length)

    return () => {
      src.removeEventListener('scroll', onSrc)
      tgt.removeEventListener('scroll', onTgt)
      cancelAnimationFrame(rafId)
      console.info('[linked-scroll] detached')
    }
  }, [status]) // status 变为 ready 时面板挂载，re-attach 监听

  // v5.0：源面板 hover 事件委托
  // 支持 TextPage 的 data-src-idx（char-level）+ SourcePage 文字层的 data-src-idx-start（run-level）
  useEffect(() => {
    if (status !== 'ready') return
    const src = srcScrollRef.current
    if (!src) return

    const onOver = (e: MouseEvent) => {
      // 优先 data-src-idx（TextPage char）; 其次 data-src-idx-start（source text layer run）
      const charSpan = (e.target as Element).closest('[data-src-idx]') as HTMLElement | null
      const runSpan = (e.target as Element).closest('[data-src-idx-start]') as HTMLElement | null
      if (charSpan) {
        const idx = Number(charSpan.getAttribute('data-src-idx'))
        if (Number.isFinite(idx) && idx >= 0) highlightSrcIdx(idx)
      } else if (runSpan) {
        const start = Number(runSpan.getAttribute('data-src-idx-start'))
        if (Number.isFinite(start) && start >= 0) highlightSrcIdx(start)
      }
    }
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null
      if (!related || !src.contains(related)) highlightSrcIdx(null)
    }
    src.addEventListener('mouseover', onOver)
    src.addEventListener('mouseout', onOut)
    return () => {
      src.removeEventListener('mouseover', onOver)
      src.removeEventListener('mouseout', onOut)
    }
  }, [status, highlightSrcIdx])

  // v5.1：选区联动（selectionchange → 高亮对侧对应字符）
  useEffect(() => {
    if (status !== 'ready') return

    const clearSelHighlight = () => {
      for (const ref of [srcScrollRef, tgtScrollRef]) {
        ref.current?.querySelectorAll('.is-selected').forEach(s => s.classList.remove('is-selected'))
      }
    }

    const handleSel = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { clearSelHighlight(); return }
      const range = sel.getRangeAt(0)
      const common = range.commonAncestorContainer

      const inSrc = srcScrollRef.current?.contains(common as Node) ?? false
      const inTgt = tgtScrollRef.current?.contains(common as Node) ?? false
      if (!inSrc && !inTgt) { clearSelHighlight(); return }

      let srcStart = Infinity, srcEnd = -Infinity

      if (inSrc) {
        // 源面板：char-level spans with data-src-idx-start/end
        srcScrollRef.current!.querySelectorAll<HTMLElement>('[data-src-idx-start]').forEach(span => {
          try {
            if (!span.textContent?.trim()) return // 跳过空白 span
            if (range.intersectsNode(span)) {
              const s = Number(span.getAttribute('data-src-idx-start'))
              const e = Number(span.getAttribute('data-src-idx-end'))
              if (!isNaN(s)) srcStart = Math.min(srcStart, s)
              if (!isNaN(e)) srcEnd = Math.max(srcEnd, e)
            }
          } catch {}
        })
        // 兼容 TextPage data-src-idx（txt/md 无 data-src-idx-start）
        srcScrollRef.current!.querySelectorAll<HTMLElement>('[data-src-idx]').forEach(span => {
          try {
            if (!span.textContent?.trim()) return
            if (range.intersectsNode(span)) {
              const idx = Number(span.getAttribute('data-src-idx'))
              if (!isNaN(idx) && idx >= 0) {
                srcStart = Math.min(srcStart, idx)
                srcEnd = Math.max(srcEnd, idx + 1)
              }
            }
          } catch {}
        })
      } else {
        // 目标面板：char-level spans with data-src-idx
        tgtScrollRef.current!.querySelectorAll<HTMLElement>('[data-src-idx]').forEach(span => {
          try {
            if (!span.textContent?.trim()) return // 跳过空白 span
            if (range.intersectsNode(span)) {
              const idx = Number(span.getAttribute('data-src-idx'))
              if (!isNaN(idx) && idx >= 0) {
                srcStart = Math.min(srcStart, idx)
                srcEnd = Math.max(srcEnd, idx + 1)
              }
            }
          } catch {}
        })
      }

      if (isFinite(srcStart) && srcStart < srcEnd) {
        // inSrc：源侧选区用 .is-selected 自绘（CSS 已抑制 ::selection），两侧都加
        // inTgt：目标侧保留浏览器原生 ::selection，源侧另加 .is-selected
        highlightBySourceRange(srcStart, srcEnd, inTgt ? 'tgt' : undefined)
      } else {
        clearSelHighlight()
      }
    }

    document.addEventListener('selectionchange', handleSel)
    return () => document.removeEventListener('selectionchange', handleSel)
  }, [status, highlightBySourceRange])

  // 滚到指定页（源面板，目标面板通过联动自动跟）
  const scrollToPage = useCallback((page: number) => {
    if (!result || page < 1 || page > result.pages.length) return
    setActivePage(page)
    const el = srcPageRefs.current.get(page)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [result])

  // 监听源面板滚动：高亮当前页（IntersectionObserver）
  useEffect(() => {
    if (!result || result.pages.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        let best: { page: number; ratio: number } | null = null
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const pn = Number((e.target as HTMLElement).dataset.page)
          if (Number.isNaN(pn)) continue
          if (!best || e.intersectionRatio > best.ratio) {
            best = { page: pn, ratio: e.intersectionRatio }
          }
        }
        if (best) setActivePage(best.page)
      },
      { root: srcScrollRef.current, rootMargin: '0px 0px -80% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    )
    for (const [, el] of srcPageRefs.current.entries()) {
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [result, status])

  if (!source) {
    return <div className="icm-msg">未选择源文件</div>
  }

  const totalPages = pages.length
  const hasPdfPages = !!(source.pages && source.pages.length > 0)
  const isFirst = activePage <= 1
  const isLast = activePage >= totalPages
  const gotoPage = (delta: number) => scrollToPage(Math.max(1, Math.min(totalPages, activePage + delta)))

  // v5.0：fit-width 按单面板宽度（而非整行宽度）计算
  const computeFitWidth = useCallback(() => {
    const panelEl = srcScrollRef.current
    if (!panelEl) return 1
    const panelW = panelEl.clientWidth
    if (!panelW || panelW <= 0) return 1
    const sampleW = pages[0]?.pageW || 991
    const target = (panelW * 0.92) / sampleW
    return Math.max(0.4, Math.min(1.0, +target.toFixed(2)))
  }, [pages])

  useEffect(() => {
    if (pages.length === 0) return
    const initial = computeFitWidth()
    setScale(initial)
    console.info('[translate] fit-width scale=', initial, 'panelW=', srcScrollRef.current?.clientWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length > 0 ? pages[0]?.pageW : null])

  useEffect(() => {
    const onResize = () => {
      if (pages.length === 0) return
      setScale(computeFitWidth())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length > 0 ? pages[0]?.pageW : null])

  const strategy: 'passthrough' | 'synthetic' =
    (source.previewExt || source.ext) === 'docx' || (source.previewExt || source.ext) === 'pdf'
      ? 'passthrough' : 'synthetic'

  return (
    <div
      className="ttl-container"
      data-testid="translate-layout"
      data-word-diff={wordDiffEnabled ? 'on' : 'off'}
    >

      {/* ── 顶部状态栏 ── */}
      <div className="ttl-toolbar" data-testid="translate-toolbar">
        <div className="ttl-toolbar-left">
          <span className="icm-pane-badge icm-pane-src">{sourceLang}</span>
          <span className="ttl-filename" title={source.name}>{source.name}</span>
          {hasPdfPages && source.pages && (
            <span className="ttl-pages-info">· {source.pages.length} 页</span>
          )}
        </div>
        <div className="ttl-toolbar-right">
          <div className="ttl-mode-toggle" role="group" aria-label="渲染格式">
            <button
              type="button"
              className={`icm-fmt-btn ${renderMode === 'pdf' ? 'on' : ''}`}
              onClick={() => setRenderMode('pdf')}
              disabled={!supportsPdf}
              title={supportsPdf ? 'PDF 模式：iframe 嵌入源 PDF（左侧）' : '当前文件无源 PDF，不可用'}
              data-testid="translate-mode-pdf"
            >PDF</button>
            <button
              type="button"
              className={`icm-fmt-btn ${renderMode === 'images' ? 'on' : ''}`}
              onClick={() => setRenderMode('images')}
              title="图片+文字模式：按需栅格化渲染（默认）"
              data-testid="translate-mode-images"
            >图文</button>
            <button
              type="button"
              className={`icm-fmt-btn ${renderMode === 'wasm' ? 'on' : ''}`}
              onClick={() => setRenderMode('wasm')}
              disabled={!supportsPdf}
              title={supportsPdf ? 'WASM 模式：左侧原文前端 pdfium 渲染，右侧译文服务端图片' : '当前文件无源 PDF，不可用'}
              data-testid="translate-mode-wasm"
            >WASM</button>
          </div>
          <span className="icm-fmt-sep" />
          <button
            type="button"
            className="icm-btn-ai"
            onClick={handleTranslate}
            disabled={loading}
            data-testid="translate-ai-btn"
          >
            {loading ? '翻译中…' : (result ? '🔄 重新翻译' : '🌐 AI 翻译')}
          </button>
          <span className="icm-lang-arrow" aria-hidden="true">→</span>
          <select
            className="icm-lang-select"
            aria-label="源语言"
            value={sourceLang}
            onChange={e => setSourceLang(e.target.value as LangCode)}
            data-testid="translate-source-lang"
          >
            {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
          <span className="icm-lang-arrow" aria-hidden="true">→</span>
          <select
            className="icm-lang-select"
            aria-label="目标语言"
            value={targetLang}
            onChange={e => setTargetLang(e.target.value as LangCode)}
            data-testid="translate-target-lang"
          >
            {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
          <span className="icm-fmt-sep" />
          <button type="button" className="icm-fmt-btn" onClick={() => setScale(s => Math.max(0.4, +(s - 0.1).toFixed(2)))} title="缩小" aria-label="缩小">−</button>
          <span className="icm-zoom-label" data-testid="translate-zoom">{Math.round(scale * 100)}%</span>
          <button type="button" className="icm-fmt-btn" onClick={() => setScale(s => Math.min(2, +(s + 0.1).toFixed(2)))} title="放大" aria-label="放大">+</button>
          <button type="button" className="icm-fmt-btn" onClick={() => setScale(computeFitWidth())} title="适应宽度" aria-label="适应宽度" data-testid="translate-fit-width">⤢</button>
          <span className="icm-fmt-sep" />
          <button type="button" className="icm-fmt-btn" onClick={() => setThumbScale(s => s > 0.6 ? s - 0.2 : s)} title="缩小缩略图">⊟</button>
          <span className="icm-zoom-label">{Math.round(thumbScale * 100)}%</span>
          <button type="button" className="icm-fmt-btn" onClick={() => setThumbScale(s => Math.min(1.4, s + 0.2))} title="放大缩略图">⊞</button>
          <span className="icm-fmt-sep" />
          <button type="button" className="icm-fmt-btn" onClick={copySource} title="复制原文" data-testid="translate-copy-source">📄</button>
          <button type="button" className="icm-fmt-btn" onClick={copyTarget} title="复制译文" data-testid="translate-copy-target">🌐</button>
          <button type="button" className="icm-fmt-btn" onClick={copyBilingual} title="复制双语对照" data-testid="translate-copy-bilingual">📋</button>
          <span className="icm-fmt-sep" />
          {/* Phase A.3: 词级对比 toggle */}
          <button
            type="button"
            className={`icm-fmt-btn ${wordDiffEnabled ? 'on' : ''}`}
            title={wordDiffEnabled ? '关闭词级对比' : '开启词级对比（红删 / 蓝插）'}
            data-testid="translate-layout-word-diff"
            data-word-diff={wordDiffEnabled ? 'on' : 'off'}
            onClick={() => setWordDiff(!wordDiffEnabled)}
            aria-pressed={wordDiffEnabled}
            aria-label="词级对比"
          >🔍词级</button>
          <button
            type="button"
            className="icm-fmt-btn"
            title="下载"
            data-testid="translate-layout-download"
            data-has-handler={onDownload ? 'true' : 'false'}
            onClick={() => onDownload?.()}
            aria-label="下载双语文档"
          >⬇</button>
        </div>
      </div>

      {/* ── 状态区 ── */}
      {status === 'idle' && (
        <div className="icm-msg icm-translate-hint" data-testid="translate-empty">
          <div className="hint-emoji">🌐</div>
          <div>点击右上角「AI 翻译」开始翻译</div>
          <div className="hint-sub">支持 txt / md / PDF / DOCX · 按页对照 · DOCX→PDF 实时渲染</div>
        </div>
      )}
      {status === 'loading' && (
        <div className="icm-msg icm-translate-loading" data-testid="translate-loading">
          <div className="loading-spinner" aria-hidden="true" />
          <div>翻译中…</div>
        </div>
      )}
      {status === 'error' && (
        <div className="icm-msg icm-msg-err" data-testid="translate-error">
          <div>翻译失败：{error}</div>
          <button type="button" className="btn-mini" onClick={handleTranslate} disabled={loading}>重试</button>
        </div>
      )}

      {/* ── 主体：缩略图 + 双面板 ── */}
      {status === 'ready' && result && pages.length > 0 && (
        <div className="ttl-body" data-testid="translate-body">
          <aside className="ttl-thumbs" data-testid="translate-thumbs" aria-label="页面缩略图">
            {pages.map((p, i) => (
              <ThumbCard
                key={p.page}
                page={p}
                pageNum={i + 1}
                isActive={activePage === i + 1}
                onClick={() => scrollToPage(i + 1)}
                sourcePage={hasPdfPages ? source.pages![i] : undefined}
                scale={thumbScale}
              />
            ))}
          </aside>

          {/* v5.0：双面板区域 */}
          <div className="ttl-panels" data-testid="translate-panels">

            {/* 左面板：原文 */}
            <div
              className="ttl-src-scroll"
              ref={srcScrollRef}
              data-testid="translate-src-scroll"
            >
              <div className="ttl-panel-header">
                <span className="ttl-panel-label">原文</span>
                <span className="icm-pane-badge icm-pane-src">{sourceLang}</span>
              </div>
              <div className="ttl-src-grid">
                {pages.map((p, i) => {
                  const pdfPage = hasPdfPages ? source.pages![i] : undefined
                  const cellW = p.pageW * scale
                  const cellH = p.pageH * scale
                  return (
                    <div
                      key={p.page}
                      className={`ttl-page-item ${activePage === i + 1 ? 'is-active' : ''}`}
                      data-page={i + 1}
                      ref={el => { if (el) srcPageRefs.current.set(i + 1, el) }}
                    >
                      <div
                        className="ttl-page-cell ttl-page-src"
                        data-side="left"
                        data-page={i + 1}
                        style={{ width: `${cellW}px`, height: `${cellH}px` }}
                      >
                        {/* v5.1：统一用 SourcePage（图片+文字层覆盖）
                            - images 模式：服务端图片 + pdfium 文字层（可选区 + 联动）
                            - wasm 模式：pdfium WASM canvas + 文字层（targetW/H 精确尺寸）
                            - pdf embed 废弃：embed 显示整本 PDF，无法限定单页 */}
                        <SourcePage
                          taskId={source!.id}
                          pageNum={i + 1}
                          pageW={p.pageW}
                          pageH={p.pageH}
                          scale={scale}
                          sourceText={p.sourceText}
                          imageUrl={pdfPage?.url || null}
                          usePdfWasm={renderMode === 'wasm' && supportsPdf}
                          pdfUrl={sourcePdfUrl}
                          onHoverSrcIdx={highlightSrcIdx}
                        />
                        <div className="ttl-page-num">{i + 1}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 竖向分割线 */}
            <div className="ttl-panels-divider" aria-hidden="true" />

            {/* 右面板：译文（始终 server images 管线） */}
            <div
              className="ttl-tgt-scroll"
              ref={tgtScrollRef}
              data-testid="translate-tgt-scroll"
            >
              <div className="ttl-panel-header">
                <span className="ttl-panel-label">译文</span>
                <span className="icm-pane-badge icm-pane-tgt">{targetLang}</span>
              </div>
              <div className="ttl-tgt-grid">
                {pages.map((p, i) => {
                  const cellW = p.pageW * scale
                  const cellH = p.pageH * scale
                  return (
                    <div
                      key={p.page}
                      className="ttl-page-item"
                      data-page={i + 1}
                    >
                      <div
                        className="ttl-page-cell ttl-page-tgt"
                        data-side="right"
                        data-page={i + 1}
                        data-testid={`translate-tgt-cell-${i + 1}`}
                        style={{ width: `${cellW}px`, height: `${cellH}px` }}
                      >
                        <TranslatedPage
                          taskId={source.id}
                          pageNum={i + 1}
                          targetLang={targetLang}
                          sourceLang={sourceLang}
                          paperScale={scale}
                          cellW={p.pageW}
                          cellH={p.pageH}
                          onHoverSrcIdx={highlightSrcIdx}
                          strategy={strategy}
                        />
                        <div className="ttl-page-num ttl-page-num-tgt">{i + 1}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── 翻页控制 ── */}
      {status === 'ready' && result && pages.length > 0 && (
        <div className="ttl-pager" data-testid="translate-pager">
          <button type="button" className="icm-fmt-btn" onClick={() => scrollToPage(1)} disabled={isFirst} aria-label="首页" title="首页">«</button>
          <button type="button" className="icm-fmt-btn" onClick={() => gotoPage(-1)} disabled={isFirst} aria-label="上一页" title="上一页">‹</button>
          <span className="ttl-pager-info" data-testid="translate-pager-info">{activePage} / {totalPages}</span>
          <button type="button" className="icm-fmt-btn" onClick={() => gotoPage(1)} disabled={isLast} aria-label="下一页" title="下一页">›</button>
          <button type="button" className="icm-fmt-btn" onClick={() => scrollToPage(totalPages)} disabled={isLast} aria-label="末页" title="末页">»</button>
        </div>
      )}

      {/* ── 底部信息条 ── */}
      <div className="icm-translate-footer" data-testid="translate-footer">
        {result && status === 'ready' ? (
          <>
            <span>译文 {result.segments.length} 段</span>
            <span className="dot">·</span>
            <span>{totalPages} 页</span>
            <span className="dot">·</span>
            <span>原文 {result.meta.sourceChars} 字符</span>
            <span className="dot">·</span>
            <span>译文 {result.meta.targetChars} 字符</span>
            <span className="dot">·</span>
            <span>{result.ms}ms</span>
            <span className="dot">·</span>
            <span>{result.meta.engine}</span>
            <span className="dot">·</span>
            <span>双滚动同步 · 右栏 on-demand</span>
          </>
        ) : (
          <span>翻译双栏对照（双滚动同步）· {sourceLang} → {targetLang}</span>
        )}
      </div>
    </div>
  )
}

/**
 * 纯文本页（用于左 cell 非 PDF 任务）— v5.0
 * 每字一个 span 带 data-src-idx，hover 通过父容器事件委托处理
 * 同时保留 onMouseEnter/onMouseLeave React 事件以兼容测试（fireEvent.mouseEnter）
 */
function TextPage({
  text,
  onHoverSrcIdx,
}: {
  text: string
  onHoverSrcIdx: (idx: number | null) => void
}) {
  const lines = text.split('\n')
  let srcIdx = 0
  return (
    <div className="ttl-page-body">
      {lines.map((line, lineIdx) => {
        const lineStart = srcIdx
        const chars = Array.from(line)
        const lineEls = chars.map((ch, i) => {
          const idx = lineStart + i
          return (
            <span
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className="ttl-char"
              data-src-idx={idx}
              onMouseEnter={() => onHoverSrcIdx(idx)}
              onMouseLeave={() => onHoverSrcIdx(null)}
            >
              {ch}
            </span>
          )
        })
        srcIdx = lineStart + chars.length + (lineIdx < lines.length - 1 ? 1 : 0)
        return (
          // eslint-disable-next-line react/no-array-index-key
          <p key={lineIdx} className="ttl-page-line">
            {lineEls.length > 0 ? lineEls : '\u00A0'}
          </p>
        )
      })}
    </div>
  )
}
