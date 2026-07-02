// PDFium 文字覆盖层（服务端 Node，run-level 渲染 — 对标 PDF.js 行业标杆）
// 模型：claude-sonnet-4-6
// 关键变更（v4 像素级对齐）：
//   - 直接使用 PDFium ink bbox 的 top/bottom 坐标定位 span
//   - 不再使用 baselineY - ASCENT_RATIO * fontSize 近似公式
//   - 同一引擎渲染 PNG 和提取 bbox → span 坐标 100% 对齐 ink 像素
//   - 版本号 data-pdfium="3"，触发旧格式自动重生
// CSS 约定（在 web/styles.css）：
//   .pdf-text-layer span {
//     line-height: 1; transform-origin: 0 0;
//     white-space: pre; overflow: hidden;
//     transform: scaleX(N); /* 客户端 JS 补偿浏览器字体宽度差异 */
//   }
import fs from 'node:fs'
import path from 'node:path'
import { pdfiumExtractTextRuns, pdfiumGetPageCount } from './pdfium-render.mjs'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 单个 text-run → <span>（ink bbox 直接定位，像素级对齐）
 * 输入：{ str, fontSize, left, right, top, bottom }
 *
 * 定位原则（v4 — 去除 ASCENT_RATIO 近似）：
 *   top    = run.top            ← PDFium ink bbox 顶边，与 PNG ink 像素 100% 对齐
 *   height = max(inkH, fontSize × 0.5)  ← ink 高度兜底，保证选区覆盖
 *   width  = max(inkW, fontSize × 0.5)  ← ink 宽度兜底
 *   font-size = fontSize        ← 用于客户端 scaleX 计算的参考值
 *
 * 客户端（PdfImagesPreview.tsx）会在注入后测量浏览器字体宽度并应用
 *   transform: scaleX(pdfWidth / browserWidth)
 * 使透明字符与 PNG ink 水平对齐，消除字体替换漂移。
 */
function runToSpan(run) {
  const fontSize = Math.max(run.fontSize, 1)
  const inkW = run.right - run.left
  const inkH = run.bottom - run.top
  // v3: 最小高度从 fontSize×0.5 提升到 fontSize×0.85（确保细横笔如"一"也可点选）
  // 最小宽度保留 fontSize×0.5（宽度偏差不影响命中，但高度决定可点击性）
  const top = run.top.toFixed(2)
  const height = Math.max(inkH, fontSize * 0.85).toFixed(2)
  const left = run.left.toFixed(2)
  const width = Math.max(inkW, fontSize * 0.5).toFixed(2)
  return `<span style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${fontSize.toFixed(2)}px">${escapeHtml(run.str)}</span>`
}

/**
 * 把 runs 数组转为 text-layer HTML
 * 结构与 v2 一致：根 div 带 data-pdfium / data-page-w / data-page-h
 * 每个 run 一个 span（替换 v2 的 char-level 一字一 span）
 */
export function buildRunBboxHtml(runs, pageWidthPx, pageHeightPx) {
  if (!runs.length) {
    return `<div class="pdf-text-layer" data-pdfium="4" data-page-w="${pageWidthPx.toFixed(2)}" data-page-h="${pageHeightPx.toFixed(2)}"></div>`
  }
  const spans = runs.map(runToSpan)
  return `<div class="pdf-text-layer" data-pdfium="4" data-page-w="${pageWidthPx.toFixed(2)}" data-page-h="${pageHeightPx.toFixed(2)}">${spans.join('')}</div>`
}

/**
 * v3.1：字符级 text-layer（用于翻译对照 + hover 联动）
 *
 * 与 v4 的差异：
 *   - 把每个 PDFium run 拆成 char-level span（一字一 span）
 *   - 每个 char span 带 data-tgt-idx（target 字符索引）+ data-src-idx（src 字符索引）
 *   - charMap 用于把 tgt 字符位置映射回 src 字符位置
 *   - data-pdfium="5"（不兼容 v4，旧产物自动重生）
 *
 * @param {Array<{str,left,right,top,bottom,fontSize}>} runs - PDFium 提取的 runs
 * @param {number} pageWidthPx
 * @param {number} pageHeightPx
 * @param {string} targetText - 译文全文（用于把 run.str 锚定到具体 tgt 字符位置）
 * @param {Array<{srcStart,srcEnd,tgtStart,tgtEnd}>} charMap - 字符级对应
 * @returns {string} HTML 字符串
 */
export function buildTextLayerWithCharMap(runs, pageWidthPx, pageHeightPx, targetText, charMap) {
  const w = pageWidthPx.toFixed(2)
  const h = pageHeightPx.toFixed(2)
  if (!runs.length) {
    return `<div class="pdf-text-layer" data-pdfium="5" data-page-w="${w}" data-page-h="${h}"></div>`
  }

  // 1) 构建 tgt idx → src idx 查找表
  //    charMap 一段 (srcStart..srcEnd) 对应 (tgtStart..tgtEnd)
  //    每段内 tgtStart 对应 srcStart，后续 tgt 仍属同一 src（hover 时高亮整段）
  const tgtToSrc = new Array(targetText.length).fill(-1)
  for (const seg of charMap) {
    for (let t = seg.tgtStart; t < seg.tgtEnd; t++) {
      if (t < tgtToSrc.length) tgtToSrc[t] = seg.srcStart
    }
  }

  // 2) 把每个 run 拆成 char span
  const spans = []
  let tgtSearchPos = 0
  for (const run of runs) {
    const runStr = run.str
    // 找到 runStr 在 targetText 中的位置
    const startPos = targetText.indexOf(runStr, tgtSearchPos)
    if (startPos === -1) {
      // 降级：找不到时输出整 run span（无 char-level data）
      spans.push(runToSpan(run))
      continue
    }
    tgtSearchPos = startPos + runStr.length

    // 按 char 拆分（处理 surrogate pair：Array.from 保证正确）
    const runChars = Array.from(runStr)
    const runWidth = run.right - run.left
    const charWidth = runChars.length > 0 ? runWidth / runChars.length : runWidth
    for (let i = 0; i < runChars.length; i++) {
      const tgtIdx = startPos + i
      const srcIdx = tgtToSrc[tgtIdx] ?? -1
      const charLeft = run.left + i * charWidth
      const charWidthActual = charWidth
      spans.push(charToSpan({
        str: runChars[i],
        left: charLeft,
        right: charLeft + charWidthActual,
        top: run.top,
        bottom: run.bottom,
        fontSize: run.fontSize,
        tgtIdx,
        srcIdx,
      }))
    }
  }

  return `<div class="pdf-text-layer" data-pdfium="5" data-page-w="${w}" data-page-h="${h}">${spans.join('')}</div>`
}

/** 单 char → span（带 data-tgt-idx / data-src-idx） */
function charToSpan({ str, left, right, top, bottom, fontSize, tgtIdx, srcIdx }) {
  const fs = Math.max(fontSize, 1)
  const inkW = right - left
  const inkH = bottom - top
  const topPx = top.toFixed(2)
  const height = Math.max(inkH, fs * 0.85).toFixed(2)
  const leftPx = left.toFixed(2)
  const width = Math.max(inkW, fs * 0.5).toFixed(2)
  return `<span data-tgt-idx="${tgtIdx}" data-src-idx="${srcIdx}" style="position:absolute;left:${leftPx}px;top:${topPx}px;width:${width}px;height:${height}px;font-size:${fs.toFixed(2)}px">${escapeHtml(str)}</span>`
}

/**
 * v6 fullDoc 文字层（global charMap + pageOffset 切片）
 * 模型：claude-sonnet-4-6
 *
 * 与 v5 (buildTextLayerWithCharMap) 的差异：
 *   - charMap 是 fullDoc 内的全局 offset（不是单页 offset）
 *   - pageSlice 让本函数能按页切分 fullDoc 文字层
 *   - 每个 span 的 data-tgt-idx / data-src-idx 是 fullDoc 全局 offset
 *   - data-pdfium="6"
 *
 * @param {Array<{str,left,right,top,bottom,fontSize}>} runs - PDFium 提取的 runs（单页）
 * @param {number} pageWidthPx
 * @param {number} pageHeightPx
 * @param {string} fullTgt - 全文译文（identity 时 = 全文源文）
 * @param {Array<{srcStart,srcEnd,tgtStart,tgtEnd}>} globalCharMap - fullDoc charMap
 * @param {{ pageCharStart: number, pageCharEnd: number }} pageSlice - 该页对应的 fullTgt 字符范围
 * @returns {string} HTML with data-pdfium="6"
 */
export function buildFullDocTextLayer(runs, pageWidthPx, pageHeightPx, fullTgt, globalCharMap, pageSlice) {
  const w = pageWidthPx.toFixed(2)
  const h = pageHeightPx.toFixed(2)
  const pageCharStart = pageSlice?.pageCharStart ?? 0
  const pageCharEnd = pageSlice?.pageCharEnd ?? (fullTgt ? Array.from(fullTgt).length : 0)

  if (!runs.length) {
    return `<div class="pdf-text-layer" data-pdfium="6" data-page-w="${w}" data-page-h="${h}"></div>`
  }

  // 1) 构建 tgt idx → src idx 查找表（globalCharMap 全局映射）
  //    charMap 一段 (srcStart..srcEnd) 对应 (tgtStart..tgtEnd)
  //    每段内 tgtStart 对应 srcStart，后续 tgt 仍属同一 src
  const tgtToSrc = new Array(fullTgt.length).fill(-1)
  for (const seg of globalCharMap || []) {
    for (let t = seg.tgtStart; t < seg.tgtEnd; t++) {
      if (t < tgtToSrc.length) tgtToSrc[t] = seg.srcStart
    }
  }

  // 2) 按 run 顺序拆 char-level span（pageSlice 内的部分）
  const spans = []
  let tgtSearchPos = pageCharStart
  for (const run of runs) {
    const runStr = run.str
    // 在 fullTgt 中找 runStr（搜索起点 = pageCharStart，避免上一行的搜索 pos 干扰）
    const startPos = fullTgt.indexOf(runStr, tgtSearchPos)
    if (startPos === -1) {
      // 降级：找不到时输出整 run span（无 char-level data）
      spans.push(runToSpan(run))
      continue
    }
    tgtSearchPos = startPos + runStr.length

    const runChars = Array.from(runStr)
    const runWidth = run.right - run.left
    const charWidth = runChars.length > 0 ? runWidth / runChars.length : runWidth
    for (let i = 0; i < runChars.length; i++) {
      const tgtIdx = startPos + i
      // 跳过本页范围外的字符
      if (tgtIdx < pageCharStart || tgtIdx >= pageCharEnd) continue
      const srcIdx = tgtToSrc[tgtIdx] ?? -1
      const charLeft = run.left + i * charWidth
      spans.push(charToSpan({
        str: runChars[i],
        left: charLeft,
        right: charLeft + charWidth,
        top: run.top,
        bottom: run.bottom,
        fontSize: run.fontSize,
        tgtIdx,
        srcIdx,
      }))
    }
  }

  return `<div class="pdf-text-layer" data-pdfium="6" data-page-w="${w}" data-page-h="${h}">${spans.join('')}</div>`
}

/** 单页提取并写 HTML 文件（page 1-based） */
export async function pdfiumExtractTextLayer(pdfPath, page, outPath, opts = {}) {
  const dpi = opts.renderDpi || 120
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const { pdfiumExtractTextRuns } = await import('./pdfium-render.mjs')
  const { runs, pageWidthPx, pageHeightPx, source } = await pdfiumExtractTextRuns(pdfPath, page - 1, dpi)
  const html = buildRunBboxHtml(runs, pageWidthPx, pageHeightPx)
  fs.writeFileSync(outPath, html)
  return {
    page,
    file: outPath,
    runs: runs.length,
    chars: runs.reduce((n, r) => n + r.str.length, 0),
    bytes: Buffer.byteLength(html, 'utf-8'),
    source,
    pageWidthPx,
    pageHeightPx
  }
}

/** 批量提取所有页文字层 */
export async function pdfiumExtractAllTextLayers(pdfPath, outDir, prefix = 'page', parallel = 1, dpi = 120, onProgress = null) {
  fs.mkdirSync(outDir, { recursive: true })
  const total = await pdfiumGetPageCount(pdfPath)
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
      const page = p
      const pad3 = String(page).padStart(3, '0')
      const outPath = path.join(outDir, `${prefix}-${pad3}.html`)
      try {
        const r = await pdfiumExtractTextLayer(pdfPath, page, outPath, { renderDpi: dpi })
        all.push(r)
      } catch (e) {
        console.warn(`[pdfium-text-layer] extract page ${page} failed: ${e.message}`)
        fs.writeFileSync(outPath, '<div class="pdf-text-layer"></div>')
        all.push({ page, file: outPath, runs: 0, chars: 0, bytes: 0 })
      }
      done++
      if (onProgress) onProgress(done)
    }
  }))
  all.sort((a, b) => a.page - b.page)
  return all
}

// ============ 兼容旧 API ============
// pdf-rasterize.mjs / router.mjs 仍可能 import 这些名字（已重写实现）
export const buildCharBboxHtml = buildRunBboxHtml  // 旧名 alias，便于向后兼容
