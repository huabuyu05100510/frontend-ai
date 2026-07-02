/**
 * 多模态 AI 渲染引擎 — 公共类型定义
 */

// ──────────────────── PageData API（服务端格式转换契约）────────────────────

/** 文字块类型：服务端提取，前端 format-agnostic 渲染 */
export type BlockType =
  | 'heading'    // 标题
  | 'paragraph'  // 正文段落
  | 'cell'       // 表格单元格
  | 'caption'    // 图片说明
  | 'formula'    // 公式（pass-through）
  | 'image'      // 图片区域（pass-through）
  | 'separator'  // 分割线

/** 文字块 —— 覆盖层的基本单元 */
export interface TextBlock {
  id: string
  bbox: { x: number; y: number; w: number; h: number }  // 自然像素空间
  text: string
  type: BlockType
  translation?: string      // 译文（翻译场景）
  confidence?: number       // 0-1
  label?: string            // field/cell 字段名
  tableId?: string          // 所属表格 id
  row?: number
  col?: number
}

/** 服务端返回的页面数据单元 */
export interface PageData {
  pageNum: number
  imageUrl: string          // WebP 页面渲染图
  naturalWidth: number
  naturalHeight: number
  blocks: TextBlock[]
}

/** 文档流式事件（模拟 SSE） */
export type DocStreamEvent =
  | { type: 'PAGE_READY'; data: PageData }
  | { type: 'TRANSLATION_READY'; pageNum: number; blocks: TextBlock[] }
  | { type: 'DOC_COMPLETE'; totalPages: number }
  | { type: 'ERROR'; message: string }

/** AI 内容流事件 */
export type AIStreamEvent =
  | { type: 'TEXT_DELTA'; delta: string }
  | { type: 'FUNCTION_CALL_DELTA'; delta: string }
  | { type: 'FUNCTION_CALL_DONE'; name: string; args: Record<string, unknown> }
  | { type: 'DONE' }

// ──────────────────── 基础几何类型 ────────────────────

/** 矩形区域（左上角 + 宽高） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 二维点 */
export interface Point {
  x: number
  y: number
}

/** 尺寸 */
export interface Size {
  width: number
  height: number
}

// ──────────────────── 标注坐标系 ────────────────────

/** 图片场景：固定像素坐标 */
export interface PixelPosition {
  kind: 'pixel'
  bbox: Rect
}

/** 文档场景：页码 + 页内坐标（单位 pt） */
export interface PagePosition {
  kind: 'page'
  page: number
  bbox: Rect
}

/** 文本场景：字符偏移量 */
export interface OffsetPosition {
  kind: 'offset'
  from: number
  to: number
}

/** 位置联合类型 */
export type Position = PixelPosition | PagePosition | OffsetPosition

// ──────────────────── 标注类型 ────────────────────

/** 所有标注类型枚举 */
export type AnnotationType =
  | 'translation-paragraph'  // 翻译段落映射
  | 'error-spelling'         // 拼写错误
  | 'error-grammar'          // 语法错误
  | 'error-punctuation'      // 标点错误
  | 'error-number'           // 数字错误
  | 'error-political'        // 涉政词
  | 'ocr-region'             // OCR 识别区域
  | 'ocr-field'              // OCR 自定义字段

// ──────────────────── OCR 字段配置 ────────────────────

/** OCR 自定义字段配置 */
export interface FieldConfig {
  id: string
  label: string
  dataType: 'text' | 'number' | 'date' | 'checkbox' | 'select'
  required: boolean
  regex?: string
  description?: string
  order: number
}

/** OCR 模板 */
export interface OCRTemplate {
  id: string
  name: string
  description?: string
  sampleImageUrl?: string
  fields: FieldConfig[]
  createdAt: number
  updatedAt: number
}

// ──────────────────── 标注主体 ────────────────────

/** 标注内容 */
export interface AnnotationContent {
  original: string
  suggestion?: string
  translation?: string
  confidence?: number
  fieldConfig?: FieldConfig
}

/** 标注接口 */
export interface Annotation {
  id: string
  type: AnnotationType
  position: Position
  content: AnnotationContent
  status: 'active' | 'accepted' | 'ignored'
  meta?: Record<string, unknown>
}

// ──────────────────── 文档段落 ────────────────────

/** 文档段落 */
export interface Paragraph {
  id: string
  page: number
  bbox: Rect
  text: string
  index: number
}

/** 段落映射关系 */
export interface ParagraphMapping {
  sourceId: string
  targetId: string
  confidence: number
}

// ──────────────────── 交互状态机 ────────────────────

/** 交互状态联合类型 */
export type InteractionState =
  | { type: 'idle' }
  | { type: 'hover'; annotationId: string }
  | { type: 'selected'; annotationId: string }
  | { type: 'multiSelected'; annotationIds: string[] }
  | { type: 'drawing'; startPt: Point; currentPt: Point }

// ──────────────────── 事件总线 ────────────────────

/** 内核事件联合类型（13种） */
export type KernelEvent =
  | { type: 'ANNOTATION_HOVER'; id: string | null }
  | { type: 'ANNOTATION_SELECT'; id: string }
  | { type: 'ANNOTATION_MULTI_SELECT'; ids: string[] }
  | { type: 'ANNOTATION_ACCEPT'; id: string }
  | { type: 'ANNOTATION_IGNORE'; id: string }
  | { type: 'ANNOTATIONS_LOADED'; annotations: Annotation[] }
  | { type: 'SCROLL_TO'; annotationId: string }
  | { type: 'DRAW_START'; pt: Point }
  | { type: 'DRAW_UPDATE'; pt: Point }
  | { type: 'DRAW_END'; rect: Rect }
  | { type: 'FIELD_CONFIG_OPEN'; fieldId: string; rect: Rect }
  | { type: 'FIELD_SAVED'; config: FieldConfig }
  | { type: 'FIELD_DELETED'; fieldId: string }
  | { type: 'ANNOTATION_ADDED'; annotation: Annotation }

// ──────────────────── OCR 识别结果 ────────────────────

/** OCR 识别结果条目 */
export interface OCRResult {
  id: string
  text: string
  bbox: Rect
  confidence: number
  order: number
}

// ──────────────────── 文本项（PDF 文字层） ────────────────────

/** PDF 文本项 */
export interface TextItem {
  text: string
  bbox: Rect
  fontSize: number
}

// ──────────────────── SVGLayer 样式 ────────────────────

/** 标注框样式 */
export interface BoxStyle {
  strokeColor: string
  fillColor: string
  strokeWidth: number
  borderRadius?: number
}
