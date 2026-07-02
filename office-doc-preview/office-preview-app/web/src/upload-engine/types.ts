// ============================================================
// 类型系统 — 完整上传生命周期状态机
// ============================================================

/** 上传场景 */
export type UploadScenario =
  | 'universal'  // 全格式：接受任意类型，图片自动压缩
  | 'document'   // 文档翻译：23 种格式，< 50MB，批量 ≤ 10
  | 'image'      // 图片翻译/OCR：4 种格式，< 4MB，20-10000px
  | 'audio'      // 音频翻译：9 种格式，< 1GB，最大 5h
  | 'video'      // 视频翻译：10 种格式，< 1GB，最大 5h
  | 'ai-image'   // AI 图搜：EXIF 矫正 + 压缩

/** 图片编码目标格式（auto = 运行时按源格式+浏览器能力择优） */
export type CompressFormat =
  | 'auto'
  | 'image/avif'
  | 'image/webp'
  | 'image/jpeg'
  | 'image/png'

/**
 * 上传生命周期状态（单向流转）
 * idle → validating → [processing] → hashing → [checking] → uploading
 *    → [merging] → done / instant / failed / cancelled
 */
export type UploadStatus =
  | 'idle'
  | 'validating'
  | 'processing'
  | 'hashing'
  | 'checking'
  | 'uploading'
  | 'merging'
  | 'done'
  | 'paused'
  | 'failed'
  | 'cancelled'
  | 'instant'

/** 上传配置 */
export interface UploadConfig {
  scenario: UploadScenario
  accept: string[]                // 允许的扩展名（不含点）
  maxSize: number                 // 单文件最大字节数
  maxCount: number                // 批量最大文件数
  maxDimension?: { w: number; h: number }  // 图片尺寸限制
  minDimension?: { w: number; h: number }
  chunkSize: number               // 分片大小（字节），0 表示直传
  concurrent: number              // 并发分片数
  retry: number                   // 最大重试次数
  // 图片处理
  exifCorrect: boolean
  compress: boolean
  compressQuality: number         // 0-1
  compressMaxPx: number           // 最长边最大像素
  compressFormat?: CompressFormat // 目标编码格式，默认 auto
  compressTargetKB?: number       // 目标体积（KB）；设置后自适应二分质量逼近
  // 接口地址
  uploadUrl: string
  chunkUrl: string
  mergeUrl: string
  checkUrl: string                // 秒传检查接口
  // 额外请求头
  headers?: Record<string, string>
  // 存储适配器（设置后接管上传，绕过内置 REST 策略，用于对接 OSS/COS/S3 等）
  adapter?: StorageAdapter
}

/** 存储适配器上下文 */
export interface StorageUploadCtx {
  hash: string
  onProgress: (pct: number) => void
  signal?: AbortSignal
}

/**
 * 存储适配器：把"上传到哪、怎么传"抽象出来。
 * 内置 REST 策略是默认实现；OSS/COS/S3 等通过实现本接口接入。
 */
export interface StorageAdapter {
  name: string
  upload(file: File, ctx: StorageUploadCtx): Promise<{ url: string }>
}

/** 单个文件上传状态 */
export interface UploadFile {
  id: string
  name: string
  size: number
  type: string
  status: UploadStatus
  progress: number                // 0-100
  hash: string | null
  url: string | null              // 上传成功后的 URL
  error: string | null
  previewUrl: string | null       // 图片/视频本地预览
  compressedSize: number | null   // 压缩后大小
  compressMeta: CompressMeta | null // 压缩详情（格式/质量/压缩率）
  chunks: ChunkStatus[]           // 分片状态
  createdAt: number
}

/** 图片压缩结果元数据 */
export interface CompressMeta {
  fromFormat: string              // 源 MIME，如 image/png
  toFormat: string                // 输出 MIME，如 image/webp
  quality: number                 // 实际采用质量 0-1
  ratio: number                   // 压缩率 = 1 - compressed/original
  width: number                   // 输出宽
  height: number                  // 输出高
  durationMs: number              // 压缩耗时
  engine: 'worker' | 'main'       // 执行环境
}

/** 分片状态 */
export interface ChunkStatus {
  index: number
  uploaded: boolean
  progress: number
  retries: number
}

/** 上传事件 */
export type UploadEvent =
  | { type: 'status'; fileId: string; status: UploadStatus }
  | { type: 'progress'; fileId: string; progress: number }
  | { type: 'hash'; fileId: string; hash: string }
  | { type: 'chunk'; fileId: string; index: number; progress: number }
  | { type: 'done'; fileId: string; url: string }
  | { type: 'instant'; fileId: string; url: string }
  | { type: 'error'; fileId: string; error: string }
  | { type: 'cancel'; fileId: string }