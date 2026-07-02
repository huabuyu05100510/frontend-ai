// 性能指标中心：供 PdfPreview 写入、PerfPanel 订阅
import { create } from 'zustand'

export interface PerfMetrics {
  // 文档
  docUrl: string
  pages: number
  docSize: number
  downloaded: number
  downloadBps: number
  // 首屏 / 解析
  tParseMs: number      // getDocument resolve
  tFirstPageMs: number  // 首页上屏
  tLoadStart: number
  // 渲染运行时
  renderedPages: number
  lastRenderMs: number
  poolHits: number
  poolMisses: number
  // 运行
  fps: number
  scrollVel: number     // px/s
  memMb: number         // performance.memory usedJSHeapSize (Chrome)
  // 预测渲染引擎
  predictiveLevel: 'idle' | 'warming' | 'prefetch' | 'cooldown' | string
  predictiveBuffer: number
  // 转码（来自 task）
  convertMs: number
  convertRetries: number
  convertEtaSec: number
  convertElapsedSec: number
  rasterizeMs: number   // 栅格化耗时（来自 task.convertRasterizeMs）
  previewSize: number
  ratio: number         // preview/original
  // 选区对齐可观测（图片+文字层模式）：text-layer span 与 PNG 实际 ink 位置误差
  alignErrorAvg: number  // 平均误差（px）
  alignErrorMax: number  // 最大误差（px）
  alignSamples: number   // 采样 span 数
  // PDFium 引擎可观测（服务端 X-Render-Engine / X-Render-Ms / X-Char-Count 响应头）
  renderEngine: 'pdfium-wasm' | 'fallback-poppler' | 'unknown'
  pdfiumRenderMs: number    // 最近一页渲染耗时（来自 X-Render-Ms）
  pdfiumTotalMs: number     // 累计渲染耗时
  pdfiumCharsTotal: number  // 累计字符数
  // 翻译可观测
  translateMs: number       // 最近一次翻译总耗时
  translateSegments: number // 最近一次翻译段数
  translateTotalMs: number  // 累计翻译耗时
  translateCount: number    // 累计翻译次数
  translateEngine: string   // 翻译引擎标识
  // WASM v2 可观测（pdf-wasm-v2 Worker + Coordinator）
  wasmWorkerInitMs: number      // Worker 初始化耗时
  wasmRenderQueueDepth: number  // 当前渲染队列深度
  wasmBitmapCacheEntries: number
  wasmBitmapCacheMB: number
  wasmProgressivePhase: 'idle' | 'lowRes' | 'fullRes' | string
}

interface PerfStore extends PerfMetrics {
  set: (patch: Partial<PerfMetrics>) => void
}

const EMPTY: PerfMetrics = {
  docUrl: '', pages: 0, docSize: 0, downloaded: 0, downloadBps: 0,
  tParseMs: 0, tFirstPageMs: 0, tLoadStart: 0,
  renderedPages: 0, lastRenderMs: 0, poolHits: 0, poolMisses: 0,
  fps: 0, scrollVel: 0, memMb: 0,
  predictiveLevel: 'idle', predictiveBuffer: 2,
  convertMs: 0, convertRetries: 0, convertEtaSec: 0, convertElapsedSec: 0,
  rasterizeMs: 0,
  previewSize: 0, ratio: 0,
  alignErrorAvg: 0, alignErrorMax: 0, alignSamples: 0,
  renderEngine: 'unknown',
  pdfiumRenderMs: 0, pdfiumTotalMs: 0, pdfiumCharsTotal: 0,
  translateMs: 0, translateSegments: 0, translateTotalMs: 0, translateCount: 0, translateEngine: '',
  wasmWorkerInitMs: 0, wasmRenderQueueDepth: 0, wasmBitmapCacheEntries: 0, wasmBitmapCacheMB: 0, wasmProgressivePhase: 'idle'
}

export const usePerf = create<PerfStore>((set) => ({
  ...EMPTY,
  set: (patch) => set(patch)
}))

// FPS 采样器（全局，rAF 驱动）
let lastT = performance.now()
let frames = 0
let acc = 0
let rafId = 0
function fpsLoop(t: number) {
  const dt = t - lastT
  lastT = t
  frames++
  acc += dt
  if (acc >= 500) {
    const fps = Math.round((frames * 1000) / acc)
    frames = 0; acc = 0
    const cur = usePerf.getState()
    if (cur.fps !== fps) usePerf.getState().set({ fps })
  }
  rafId = requestAnimationFrame(fpsLoop)
}
export function startFpsMeter() {
  if (!rafId) rafId = requestAnimationFrame(fpsLoop)
}
export function stopFpsMeter() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

// 内存采样（Chrome only）
export function tickMemory() {
  const m = (performance as any).memory
  if (m) usePerf.getState().set({ memMb: +(m.usedJSHeapSize / 1048576).toFixed(1) })
}
