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
  // 转码（来自 task）
  convertMs: number
  convertRetries: number
  convertEtaSec: number
  convertElapsedSec: number
  previewSize: number
  ratio: number         // preview/original
}

interface PerfStore extends PerfMetrics {
  set: (patch: Partial<PerfMetrics>) => void
}

const EMPTY: PerfMetrics = {
  docUrl: '', pages: 0, docSize: 0, downloaded: 0, downloadBps: 0,
  tParseMs: 0, tFirstPageMs: 0, tLoadStart: 0,
  renderedPages: 0, lastRenderMs: 0, poolHits: 0, poolMisses: 0,
  fps: 0, scrollVel: 0, memMb: 0,
  convertMs: 0, convertRetries: 0, convertEtaSec: 0, convertElapsedSec: 0,
  previewSize: 0, ratio: 0
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
