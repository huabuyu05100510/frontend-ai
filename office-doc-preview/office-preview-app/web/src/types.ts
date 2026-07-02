// 与后端对齐的任务类型
export type ConvertStatus =
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'rasterizing'   // 栅格化阶段
  | 'done'
  | 'failed'
export type Strategy = 'frontend' | 'convert_pdf' | 'unsupported'

export interface PageImage {
  page: number
  url: string                  // ?as=page&n=N → PNG
  textUrl?: string             // ?as=text&n=N → 文字覆盖层 HTML（可选）
  textWords?: number           // 该页文字数（性能面板）
  width: number
  height: number
  bytes?: number
}

export type ConvertStage =
  | 'convert'
  | 'linearize'
  | 'thumb'
  | 'pages'
  | 'textLayer'
  | null

export interface Task {
  id: string
  name: string
  size: number
  ext: string
  mime: string
  strategy: Strategy
  originalUrl: string
  previewUrl: string | null
  previewExt: string | null
  convertStatus: ConvertStatus
  convertError?: string | null
  convertDurationMs?: number
  convertRetries?: number
  convertEtaSec?: number
  convertElapsedSec?: number
  convertBytesPerSec?: number
  convertRasterizeMs?: number
  previewSize?: number
  // 双产物（PDF + 图片 + 文字层）
  thumbUrl?: string | null
  pages?: PageImage[]
  pagesTotal?: number
  pagesDone?: number
  textDone?: number
  convertStage?: ConvertStage
  status: string
  createdAt: number
  updatedAt: number
}

// 渲染分类
export type PreviewKind =
  | 'pdf'         // pdf.js
  | 'pdf-images'  // 服务端栅格化图片 + 文字覆盖层（推荐）
  | 'docx'        // mammoth
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'unsupported'

export function previewKindOf(task: Task): PreviewKind {
  const ext = (task.previewExt || task.ext).toLowerCase()
  if (ext === 'pdf') {
    if (task.pages && task.pages.length > 0) return 'pdf-images'
    return 'pdf'
  }
  if (ext === 'docx') return 'docx'
  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'm4a', 'aac', 'pcm', 'amr'].includes(ext)) return 'audio'
  if (['mp4', 'm4v', 'mov', 'mkv', 'flv', 'webm'].includes(ext)) return 'video'
  if (['txt', 'md'].includes(ext)) return 'text'
  return 'unsupported'
}

export function humanSize(n?: number) {
  if (!n && n !== 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export function formatTime(t: number) {
  const d = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fileIcon(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'PDF'
  if (e === 'docx' || e === 'doc') return 'DOC'
  if (e === 'pptx' || e === 'ppt') return 'PPT'
  if (e === 'xlsx' || e === 'xls') return 'XLS'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'].includes(e)) return 'IMG'
  if (['mp3', 'wav', 'm4a', 'aac'].includes(e)) return 'AUD'
  if (['mp4', 'mov', 'mkv', 'flv', 'webm'].includes(e)) return 'VID'
  if (['txt', 'md'].includes(e)) return 'TXT'
  return e.slice(0, 3).toUpperCase()
}

export function stageLabel(stage: ConvertStage): string {
  switch (stage) {
    case 'convert': return 'OnlyOffice 转换'
    case 'linearize': return '线性化'
    case 'thumb': return '缩略图'
    case 'pages': return '栅格化'
    case 'textLayer': return '文字层'
    default: return ''
  }
}

// ============ 智检 / 双栏对比 ============

/** diff 单个操作（来自服务端 /api/inspect/diff） */
export type DiffOp = { op: 'equal' | 'delete' | 'insert'; text: string }

/** 前端渲染 token（type 替 op，与前端 switch 命名一致） */
export type RenderToken = { type: 'equal' | 'delete' | 'insert'; text: string }

/** hunk：UI 渲染单元（连续 equal/change 聚类） */
export type DiffHunk =
  | { kind: 'equal'; text: string }
  | { kind: 'change'; original: string; corrected: string }

/** diff 错误条目（侧栏列表） */
export interface DiffError {
  id: string
  original: string
  corrected: string
  op: 'change' | 'delete' | 'insert'
}

/** 智检模式 */
export type InspectMode = 'inspect' | 'dual' | 'translate'

/** 翻译目标语言（i18n 标准代码） */
export type LangCode = 'zh-CN' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru'

/** 单条翻译结果（段落级） */
export interface TranslationSegment {
  /** 段落序号（与原文段落一一对应） */
  index: number
  /** 原文片段 */
  source: string
  /** 译文片段 */
  target: string
  /** 段落级 diff ops（可选，用于差异高亮） */
  charOps?: DiffOp[]
}

/** 按页翻译结果（双语阅读模式） */
export interface TranslatePage {
  /** 页序号（从 1 开始） */
  page: number
  /** 该页原文（多行，'\n' 分隔） */
  sourceText: string
  /** 该页译文（mock-v1 翻译后） */
  targetText: string
  /** 该页宽度（px，默认 A4=794） */
  pageW: number
  /** 该页高度（px，默认 A4=1123） */
  pageH: number
  /** 该页首行（1-based） */
  startLine: number
  /** 该页末行（1-based） */
  endLine: number
  /** v3.1 字符级对应：src 字符范围 → tgt 字符范围 */
  charMap?: Array<{ srcStart: number; srcEnd: number; tgtStart: number; tgtEnd: number }>
}

/** /api/inspect/translate 响应 */
export interface TranslateResponse {
  sourceLang: LangCode
  targetLang: LangCode
  segments: TranslationSegment[]
  /** 段落级 diff（与左右两栏各段落对齐） */
  paragraphBlocks: ParagraphDiffBlock[]
  /** 按页翻译结果（双语阅读模式主用） */
  pages: TranslatePage[]
  ms: number
  meta: {
    segmentsCount: number
    pagesCount: number
    sourceChars: number
    targetChars: number
    engine: 'mock-v1' | 'identity-mock-v1' | string
  }
}

/** v4.2：翻译弹层格式选择器（左右两栏同步）
 *  - 'pdf'   : iframe 嵌入源 PDF（#page=N 锚点翻页）
 *  - 'images': 图片+文字层（按需渲染，默认）
 *  - 'wasm'  : 前端 pdfium WASM 渲染源 PDF
 */
export type TranslateRenderMode = 'pdf' | 'images' | 'wasm'

/** v4.0：翻译渲染策略
 *  - 'passthrough'：DOCX/PDF 走保留原格式管线（imagePath = 源 page.png，textLayer = v6 fullDoc）
 *  - 'synthetic'（默认）：txt/md 走 v3.1 合成 A4 HTML → soffice → PDFium 管线
 */
export type TranslateStrategy = 'passthrough' | 'synthetic'

/** 翻译状态 */
export type TranslateStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 段落级 diff block（双栏对比模式） */
export interface ParagraphDiffBlock {
  kind: 'equal' | 'change' | 'delete' | 'insert'
  leftText: string
  rightText: string
  /** 字符级内嵌 diff（仅 change 类型有） */
  charOps?: DiffOp[]
}

// ============ 图片翻译（OCR + 区域对齐翻译） ============

/** OCR 识别出的单个文本区域 */
export interface OCRRegion {
  text: string
  x: number
  y: number
  width: number
  height: number
  /** 0..1 */
  confidence: number
}

/** /api/ocr/recognize 响应 */
export interface OCRResult {
  text: string
  regions: OCRRegion[]
  engine: string
  ms: number
  imageSize?: { width: number; height: number }
}

/** 批量翻译单项状态 */
export type ImageBatchItemStatus = 'pending' | 'ocr-done' | 'image-done' | 'failed'

/** 批量翻译单项 */
export interface ImageBatchItem {
  taskId: string
  status: ImageBatchItemStatus
  percent?: number
}

/** 批量翻译任务整体状态 */
export type BatchStatus = 'idle' | 'started' | 'running' | 'completed' | 'failed' | 'cancelled'

/** /api/inspect/diff 响应 */
export interface InspectDiffResponse {
  ops: DiffOp[]
  errors: DiffError[]
  hunks: DiffHunk[]
  tokens: RenderToken[]
  /** 段落级 diff blocks（granularity='paragraph' 时存在） */
  paragraphBlocks?: ParagraphDiffBlock[]
  ms: number
  meta: {
    granularity: 'char' | 'word' | 'paragraph'
    leftChars: number
    rightChars: number
    errorCount: number
  }
}

// ============ Phase B：文档翻译 / 图片翻译新增类型 ============

/** 翻译任务进度帧（JSONL polling 端点返回） */
export type TranslateJobFrame = {
  seq: number
  ts: number
  kind: 'started' | 'page-done' | 'ocr-done' | 'image-done' | 'finished' | 'failed' | 'cancelled' | 'paused' | 'resumed'
  payload: Record<string, unknown>
}

/** 术语表条目 */
export interface GlossaryTerm {
  id: string
  sourceLang: string
  targetLang: string
  source: string
  target: string
  pos?: string
  note?: string
}

/** 翻译记忆条目 */
export interface TmEntry {
  id: string
  sourceLang: string
  targetLang: string
  source: string
  target: string
  score?: number
  context?: string
}

/** 文档翻译输出格式 */
export type DocTranslateFormat = 'bilingual-docx' | 'bilingual-pdf' | 'target-pdf' | 'vtt'

// ============ Translation UX Overhaul (Phase A.3 Agent 3) ============

/** 翻译标注 — 对齐服务端 annotation-schema.mjs 的 TranslateAnnotation */
export interface TranslateAnnotation {
  id: string
  kind: 'align_fix' | 'seg_rating' | 'alt_trans'
  schemaVersion: 1
  taskId: string
  segmentId: string
  url: string
  domPath: string
  srcText: string
  tgtText: string
  langPair: [string, string]
  srcTokens: string[]
  tgtTokens: string[]
  predicted: Array<[number, number]>
  modelVersion: string
  payload: unknown
  context: unknown
  createdAt: number
  updatedAt: number
}

export type AnnotationKind = TranslateAnnotation['kind']