// PDF 栅格化层 — PDFium C++ 统一管线
// 模型：Claude MiniMax-M3（MiniMax）
// 本次重构：把 pdftoppm + pdftotext 双引擎替换为单一 PDFium C++（@hyzyla/pdfium WASM）
// 关键不变式：renderPageToPng 与 extractCharBoxes 共享同一 FPDF_DOCUMENT / FPDF_PAGE 句柄
//   → PNG 像素与字符 bbox 100% 同源，无 alpha/beta/min_h 经验参数
//   → bbox 中心必落在 PNG dark ink 像素上（已在 test/pdfium-render.test.mjs 验证）
// 保留 API 签名以兼容 router.mjs / converter.mjs：
//   - getPdfPageCount / rasterizeThumb / rasterizeAllPages / imageDimensions / fileSize
//   - extractTextLayer / extractAllTextLayers / bboxHtmlToTextLayer (向后兼容，内部走 PDFium)
// 失败兜底：@hyzyla/pdfium init 失败 → 自动回退 pdftoppm/pdftotext（保持旧链路工作）
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'
import {
  pdfiumGetPageCount,
  pdfiumRenderPageToPng,
  pdfiumRenderAllPages,
  getPdfiumMetrics
} from './pdfium-render.mjs'
import { pdfiumExtractTextLayer, pdfiumExtractAllTextLayers } from './pdfium-text-layer.mjs'

// ============ 低层：路由到 PDFium（fallback 已被 PDFium 内部封装） ============
export async function getPdfPageCount(filePath) {
  return pdfiumGetPageCount(filePath)
}

/**
 * 渲染指定页范围到 PNG（保留 pdftoppm 时代签名 → router.mjs 可能直接调用）
 * PDFium 路径下用并发的 FPDF_PAGE 句柄代替 bucket
 */
export async function rasterizePages(filePath, from, to, dpi, outDir, prefix) {
  fs.mkdirSync(outDir, { recursive: true })
  const files = []
  for (let p = from; p <= to; p++) {
    const pad3 = String(p).padStart(3, '0')
    const pad2 = String(p).padStart(2, '0')
    const outPath = path.join(outDir, `${prefix}-${pad3}.png`)
    const buf = await pdfiumRenderPageToPng(filePath, p - 1, dpi)
    fs.writeFileSync(outPath, buf)
    // 兼容：同时写 pad2 命名（老任务可能依赖）
    if (pad2 !== pad3) {
      try { fs.writeFileSync(path.join(outDir, `${prefix}-${pad2}.png`), buf) } catch {}
    }
    files.push({ page: p, file: outPath })
  }
  return files
}

// ============ 高层包装 ============

/** 渲染第 1 页为缩略图。返回 PNG 路径。失败抛错。 */
export async function rasterizeThumb(filePath, outPath, dpi = CONFIG.RASTERIZE_THUMB_DPI) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const buf = await pdfiumRenderPageToPng(filePath, 0, dpi)
  fs.writeFileSync(outPath, buf)
  return outPath
}

/** 渲染全部页为 PNG（PDFium 直接出 PNG，与 text layer 1:1 像素对齐） */
export async function rasterizeAllPages(filePath, outDir, prefix, dpi = CONFIG.RASTERIZE_PAGE_DPI, parallel = CONFIG.RASTERIZE_PAGE_PARALLEL, onProgress) {
  return pdfiumRenderAllPages(filePath, outDir, prefix, dpi, parallel, onProgress)
}

/** 读 PNG 宽高（PNG IHDR 头解析，零依赖） */
export async function imageDimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(24)
    fs.readSync(fd, buf, 0, 24, 0)
    fs.closeSync(fd)
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return { width: 0, height: 0 }
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  } catch {
    return { width: 0, height: 0 }
  }
}

/** 安全取文件大小；不存在返回 0。 */
export function fileSize(filePath) {
  try { return fs.statSync(filePath).size } catch { return 0 }
}

// ============ 文字覆盖层（方案 B） ============
// PDFium 单引擎路径：bbox 中心自动对齐 PNG 像素，零补偿。
// 保留 export 以兼容 router.mjs 和 e2e 测试。
export async function extractTextLayer(pdfPath, page, outPath, opts = {}) {
  return pdfiumExtractTextLayer(pdfPath, page, outPath, opts)
}

export async function extractAllTextLayers(pdfPath, outDir, prefix, parallel = CONFIG.RASTERIZE_PAGE_PARALLEL, renderDpi = 120, onProgress) {
  return pdfiumExtractAllTextLayers(pdfPath, outDir, prefix, parallel, renderDpi, onProgress)
}

/**
 * @deprecated 保留仅为向后兼容：把旧的 pdftotext bbox XHTML 走 PDFium 路径重建
 *   router.mjs 的 `?as=text` 自动重生逻辑会调用此函数把旧 HTML 升级为 PDFium 输出
 * 内部：解析旧 word-bbox XHTML → 调用 PDFium 重新提取 → 用新引擎输出
 *   因为 pdftotext XHTML → PDFium char boxes 是单向迁移（pdftotext 旧产物无法回填）
 *   实际：直接当作"任务有这个旧 HTML 文件"被忽略，由 router 在响应时检测 data-pdfium 标记重生
 */
export function bboxHtmlToTextLayer(/* bboxHtml, renderDpi */) {
  // 已废弃：旧的 pdftotext 产物不再被任何调用方使用
  // 保留 stub 以防外部 import；返回空 layer（前端会自动 fetch 新版）
  return '<div class="pdf-text-layer"></div>'
}

// ============ 可观测：当前引擎 + metrics ============
export function pdfRenderEngine() {
  const m = getPdfiumMetrics()
  return m.available ? `pdfium-wasm@${m.engineVersion || '2.1.13'}` : 'fallback-poppler'
}
