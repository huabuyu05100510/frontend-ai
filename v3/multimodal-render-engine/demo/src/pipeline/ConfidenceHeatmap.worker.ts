/**
 * ConfidenceHeatmap Web Worker
 *
 * 在 Worker 线程中用 OffscreenCanvas 渲染置信度热力图
 * confidence=1 → 完全透明；confidence=0 → 深红色（alpha=0.75）
 *
 * 主线程调用：
 *   worker.postMessage({ type: 'RENDER', blocks, width, height })
 *   worker.onmessage = ({ data }) => data.type === 'DONE' && drawBitmap(data.bitmap)
 */

export interface NormalizedBbox {
  x: number; y: number; w: number; h: number  // 归一化 0-1
}

export interface HeatmapRequest {
  type: 'RENDER'
  blocks: Array<{ bbox: NormalizedBbox; confidence: number }>
  width: number
  height: number
}

export interface HeatmapResponse {
  type: 'DONE'
  bitmap: ImageBitmap
}

/**
 * 计算热力图 alpha 通道值
 * @param confidence  0-1，越低越不可信
 * @returns           alpha 值 [0, 0.75]
 *
 * 导出为纯函数，便于单元测试（不依赖 Worker 环境）
 */
export function calcHeatmapAlpha(confidence: number): number {
  return (1 - confidence) * 0.75
}

// ── Worker 消息处理（仅在 Worker 环境中运行）──────────────────────────────

if (typeof self !== 'undefined' && typeof (self as unknown as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  self.onmessage = async (e: MessageEvent<HeatmapRequest>) => {
    if (e.data.type !== 'RENDER') return

    const { blocks, width, height } = e.data
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, width, height)

    for (const { bbox, confidence } of blocks) {
      const alpha = calcHeatmapAlpha(confidence)
      if (alpha < 0.01) continue  // 高置信度区域跳过（透明）

      ctx.fillStyle = `hsla(0, 100%, 45%, ${alpha})`
      ctx.fillRect(
        bbox.x * width,
        bbox.y * height,
        bbox.w * width,
        bbox.h * height,
      )
    }

    const bitmap = canvas.transferToImageBitmap()
    ;(self as unknown as Worker).postMessage({ type: 'DONE', bitmap } as HeatmapResponse, [bitmap])
  }
}
