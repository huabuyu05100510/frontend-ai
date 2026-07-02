// ============================================================================
// 通用文件预览引擎 — 内核共享类型
// ============================================================================

/** 归一后的 8 类 ViewModel 类别 */
export type ViewModelCategory =
  | 'paged' // PDF / PPTX：固定页
  | 'flow' // DOCX / TXT：可重排块流
  | 'sheet' // XLSX：稀疏单元格矩阵
  | 'raster' // 图片：瓦片金字塔
  | 'media' // 音视频
  | 'subtitle' // SRT 字幕
  | 'unknown'

/** 容器类型（魔数 / 结构识别） */
export type ContainerType =
  | 'ooxml' // docx/xlsx/pptx（zip + [Content_Types].xml）
  | 'zip'
  | 'cfb' // 老 Office（doc/xls/ppt）
  | 'mp4box' // mp4/m4v/mov
  | 'matroska' // mkv
  | 'flv'
  | 'raw'
  | null

/** 探测结果 */
export interface ProbeResult {
  ext: string // 申报扩展名（小写，无点）
  realType: string // 真实类型（魔数判定）
  container: ContainerType
  category: ViewModelCategory
  trusted: boolean // ext 与 realType 是否一致
  codecHints?: string[] // 音视频编码线索
}

/** 渲染路径三态 */
export type RenderPath = 'native' | 'wasm' | 'server'

/** 设备能力档位 */
export interface DeviceProfile {
  tier: 'low' | 'mid' | 'high'
  wasmEnabled: boolean
  hardwareConcurrency: number
  /** 是否原生支持某 mime（如 video/mp4;codecs=...） */
  canPlayType?: (mime: string) => boolean
}

/** 路由决策 */
export interface RouteDecision {
  path: RenderPath
  reason: string
}

// ----------------------------------------------------------------------------
// 视口调度
// ----------------------------------------------------------------------------

/** 可见区间（单元下标，闭区间） */
export interface Range {
  start: number
  end: number
}

/** 调度计划：哪些单元要渲染 / 预取 / 回收 */
export interface SchedulePlan {
  visible: number[] // 必须立即渲染
  prefetch: number[] // 空闲预渲染
  recycle: number[] // 可回收（之前活跃，现在不在窗口内）
}

// ----------------------------------------------------------------------------
// 三段式渐进首屏
// ----------------------------------------------------------------------------

export type ProgressiveStage = 'idle' | 'skeleton' | 'lqip' | 'hires-loading' | 'hires-ready' | 'error'

// ----------------------------------------------------------------------------
// 编辑操作（统一 EditOp）
// ----------------------------------------------------------------------------

export type EditOp =
  | { kind: 'annot.add'; id: string; anchor: ContentAnchor; shape: AnnotShape }
  | { kind: 'annot.remove'; id: string; anchor: ContentAnchor; shape: AnnotShape }
  | { kind: 'text.splice'; blockId: string; at: number; del: string; ins: string }
  | { kind: 'cell.set'; sheet: string; r: number; c: number; before: CellValue; value: CellValue }
  | { kind: 'cue.edit'; id: string; before: CuePatch; after: CuePatch }
  | { kind: 'mark.add'; id: string; t: number; label: string }
  | { kind: 'mark.remove'; id: string; t: number; label: string }

export interface ContentAnchor {
  page?: number
  xPct?: number
  yPct?: number
}

export interface AnnotShape {
  type: 'highlight' | 'box' | 'note'
  color?: string
}

export type CellValue = string | number | boolean | null

export interface CuePatch {
  start?: number
  end?: number
  text?: string
}
