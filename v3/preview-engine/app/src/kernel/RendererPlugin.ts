import type { ProbeResult } from './types'

// ============================================================================
// RendererPlugin — 渲染插件协议（内核只认接口，不认格式）
//   真实渲染器（PDF.js / OOXML / ffmpeg.wasm）实现此接口后即可被注册路由。
// ============================================================================

export type EditCapability =
  | 'annotate'
  | 'text'
  | 'cell'
  | 'cue'
  | 'mark'
  | 'trim'
  | 'mask'

export type PaintQuality = 'lqip' | 'hires'

/** 一个可渲染的「视口单元」（页 / 行块 / 瓦片 / 帧） */
export interface ViewportUnit {
  index: number
  width: number
  height: number
  quality: PaintQuality
}

export interface RendererPlugin {
  readonly name: string
  /** 能否处理该探测结果：返回 0~1 优先级分，最高者胜出 */
  match(probe: ProbeResult): number
  /** 把单元绘制到目标 canvas（真实渲染器在此调用 PDF.js / 解码器） */
  paintUnit?(unit: ViewportUnit, canvas: HTMLCanvasElement): void | Promise<void>
  /** 该格式支持的编辑能力 */
  capabilities(): EditCapability[]
}
