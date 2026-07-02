// ============================================================================
// pdfjsLoader — 运行时从 CDN 动态加载 PDF.js / pdf-lib（ESM）
//   绕开本地 npm 网络限制；生产接入私有 npm 后改为本地依赖即可（一行切换）。
//   /* @vite-ignore */ 让 Vite 不打包，由浏览器原生 ESM 动态 import。
// ============================================================================

const PDFJS_VER = '4.8.69'
const PDFLIB_VER = '1.17.1'

const PDFJS_URL = `https://esm.sh/pdfjs-dist@${PDFJS_VER}`
const PDFJS_WORKER = `https://esm.sh/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.mjs`
const PDFLIB_URL = `https://esm.sh/pdf-lib@${PDFLIB_VER}`

// 公式/符号/CJK 字形依赖这些静态资源（jsdelivr 直接服务包内文件）。
// 不配置会导致使用非嵌入标准字体的文本（含很多数学符号）渲染异常。
export const PDFJS_CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/cmaps/`
export const PDFJS_STD_FONTS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/standard_fonts/`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsPromise: Promise<any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfLibPromise: Promise<any> | null = null

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((mod) => {
      const pdfjs = mod.default ?? mod
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
      } catch {
        /* 部分构建无 worker 选项 */
      }
      return pdfjs
    })
  }
  return pdfjsPromise
}

export function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import(/* @vite-ignore */ PDFLIB_URL).then((mod) => mod.default ?? mod)
  }
  return pdfLibPromise
}
