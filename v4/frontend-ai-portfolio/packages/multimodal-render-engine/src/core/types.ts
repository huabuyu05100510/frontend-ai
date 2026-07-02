/**
 * 多模态 AI 渲染引擎 — 公共类型定义
 *
 * 覆盖四个场景的完整类型系统：翻译双栏对比、智检标注、OCR 通用识别、OCR 自定义模板
 *
 * @module core/types
 * @version 1.0.0
 */

// ============================================================================
// 基础几何类型
// ============================================================================

/** 矩形区域，x/y 为左上角坐标，w/h 为宽高 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 二维坐标点 */
export interface Point {
  x: number;
  y: number;
}

/** 尺寸 */
export interface Size {
  width: number;
  height: number;
}

// ============================================================================
// 标注位置（三种坐标系）
// ============================================================================

/** 图片场景：固定像素坐标（相对图片原始尺寸） */
export interface PixelPosition {
  readonly kind: 'pixel';
  /** 相对图片原始尺寸的像素坐标 */
  bbox: Rect;
}

/** 文档场景：页码 + 页内坐标（单位 pt） */
export interface PagePosition {
  readonly kind: 'page';
  /** 页码，0-indexed */
  page: number;
  /** 相对页面左上角的坐标，单位 pt */
  bbox: Rect;
}

/** 文本场景：字符偏移量 */
export interface OffsetPosition {
  readonly kind: 'offset';
  /** 起始字符偏移（inclusive） */
  from: number;
  /** 结束字符偏移（exclusive） */
  to: number;
}

/** 标注位置联合类型 */
export type Position = PixelPosition | PagePosition | OffsetPosition;

// ============================================================================
// 标注类型
// ============================================================================

/** 标注类型枚举 */
export type AnnotationType =
  | 'translation-paragraph'  // 翻译段落映射
  | 'error-spelling'         // 拼写错误
  | 'error-grammar'          // 语法错误
  | 'error-punctuation'      // 标点错误
  | 'error-number'           // 数字错误
  | 'error-political'        // 涉政词
  | 'ocr-region'             // OCR 识别区域
  | 'ocr-field';             // OCR 自定义字段

/** 标注内容 */
export interface AnnotationContent {
  /** 原始文本 */
  original: string;
  /** 纠错建议词（智检场景） */
  suggestion?: string;
  /** 译文（翻译场景） */
  translation?: string;
  /** 置信度 0~1 */
  confidence?: number;
  /** OCR 自定义字段配置 */
  fieldConfig?: FieldConfig;
}

/** 标注状态 */
export type AnnotationStatus = 'active' | 'accepted' | 'ignored';

/**
 * 标注实体
 *
 * 核心数据结构，贯穿所有场景。position 字段使用三种坐标系之一，
 * 由 CoordAdapter 负责转换为屏幕坐标。
 */
export interface Annotation {
  /** 唯一标识 */
  id: string;
  /** 标注类型 */
  type: AnnotationType;
  /** 标注位置（三种坐标系之一） */
  position: Position;
  /** 标注内容 */
  content: AnnotationContent;
  /** 交互状态 */
  status: AnnotationStatus;
  /** 扩展元数据 */
  meta?: Record<string, unknown>;
}

// ============================================================================
// OCR 字段配置
// ============================================================================

/** 字段数据类型 */
export type FieldDataType = 'text' | 'number' | 'date' | 'checkbox' | 'select';

/** OCR 自定义字段配置 */
export interface FieldConfig {
  /** 唯一标识 */
  id: string;
  /** 字段显示名（如"发票号码"） */
  label: string;
  /** 数据类型 */
  dataType: FieldDataType;
  /** 是否必填 */
  required: boolean;
  /** 校验正则表达式 */
  regex?: string;
  /** 字段说明 */
  description?: string;
  /** 识别结果排序 */
  order: number;
}

/** OCR 自定义模板 */
export interface OCRTemplate {
  /** 唯一标识 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string;
  /** 样本图片 URL */
  sampleImageUrl?: string;
  /** 字段配置列表 */
  fields: FieldConfig[];
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

// ============================================================================
// 文档段落
// ============================================================================

/** 文档段落 */
export interface Paragraph {
  /** 唯一标识 */
  id: string;
  /** 所在页码，0-indexed */
  page: number;
  /** 段落边界框 */
  bbox: Rect;
  /** 段落文本 */
  text: string;
  /** 文档内顺序 */
  index: number;
}

/** 原文-译文段落对齐映射 */
export interface ParagraphMapping {
  /** 原文段落 id */
  sourceId: string;
  /** 译文段落 id */
  targetId: string;
  /** 对齐置信度 0~1 */
  confidence: number;
}

// ============================================================================
// 交互状态
// ============================================================================

/** 交互状态联合类型 */
export type InteractionState =
  | { readonly type: 'idle' }
  | { readonly type: 'hover'; readonly annotationId: string }
  | { readonly type: 'selected'; readonly annotationId: string }
  | { readonly type: 'multiSelected'; readonly annotationIds: readonly string[] }
  | { readonly type: 'drawing'; readonly startPt: Point; readonly currentPt: Point }
  | { readonly type: 'resizing'; readonly fieldId: string; readonly handleIndex: number; readonly originalRect: Rect }
  | { readonly type: 'moving'; readonly fieldId: string; readonly offset: Point; readonly originalRect: Rect }
  | { readonly type: 'configuring'; readonly fieldId: string };

// ============================================================================
// 事件类型
// ============================================================================

/** 核心事件联合类型 */
export type KernelEvent =
  | { readonly type: 'ANNOTATION_HOVER'; readonly id: string | null }
  | { readonly type: 'ANNOTATION_SELECT'; readonly id: string }
  | { readonly type: 'ANNOTATION_MULTI_SELECT'; readonly ids: readonly string[] }
  | { readonly type: 'ANNOTATION_ACCEPT'; readonly id: string }
  | { readonly type: 'ANNOTATION_IGNORE'; readonly id: string }
  | { readonly type: 'ANNOTATIONS_LOADED'; readonly annotations: readonly Annotation[] }
  | { readonly type: 'SCROLL_TO'; readonly annotationId: string }
  | { readonly type: 'DRAW_START'; readonly pt: Point }
  | { readonly type: 'DRAW_UPDATE'; readonly pt: Point }
  | { readonly type: 'DRAW_END'; readonly rect: Rect }
  | { readonly type: 'RESIZE_START'; readonly fieldId: string; readonly handleIndex: number; readonly originalRect: Rect }
  | { readonly type: 'MOVE_START'; readonly fieldId: string; readonly offset: Point; readonly originalRect: Rect }
  | { readonly type: 'FIELD_CONFIG_OPEN'; readonly fieldId: string; readonly rect: Rect }
  | { readonly type: 'FIELD_CONFIG_CLOSE'; readonly fieldId: string }
  | { readonly type: 'FIELD_SAVED'; readonly config: FieldConfig }
  | { readonly type: 'FIELD_DELETED'; readonly fieldId: string };

/** 事件类型字符串 */
export type KernelEventType = KernelEvent['type'];

// ============================================================================
// 文档渲染相关
// ============================================================================

/** PDF 文本项（用于 TextLayer 构建） */
export interface TextItem {
  /** 文本内容 */
  text: string;
  /** 边界框 */
  bbox: Rect;
  /** 字号 */
  fontSize: number;
  /** 字体族 */
  fontFamily?: string;
}

/** 翻译结果 */
export interface TranslationResult {
  /** 原文段落 id */
  srcParagraphId: string;
  /** 译文文本 */
  tgtText: string;
  /** 置信度 0~1 */
  confidence: number;
}

/** OCR 识别结果 */
export interface OCRResult {
  /** 唯一标识 */
  id: string;
  /** 识别文字 */
  text: string;
  /** 相对图片原始尺寸的像素坐标 */
  bbox: Rect;
  /** 置信度 0~1 */
  confidence: number;
  /** 识别顺序 */
  order: number;
}

// ============================================================================
// 渲染器接口
// ============================================================================

/** 文档渲染器 Worker 消息 */
export interface PDFWorkerMessage {
  type: 'render' | 'cancel';
  buffer?: ArrayBuffer;
  pages?: number[];
  scale?: number;
}

/** 文档渲染器 Worker 响应 */
export interface PDFWorkerResponse {
  type: 'page' | 'error' | 'progress';
  pageIndex?: number;
  bitmap?: ImageBitmap;
  textItems?: TextItem[];
  error?: string;
  total?: number;
  completed?: number;
}

// ============================================================================
// 适配器接口
// ============================================================================

/**
 * 坐标适配器抽象接口
 *
 * 三种实现：ImageCoordAdapter / DocumentCoordAdapter / TextCoordAdapter
 */
export interface CoordAdapter {
  /** 标注位置 → 屏幕 DOMRect（跨行返回多个） */
  toScreenRects(pos: Position): DOMRect[];

  /** 屏幕点 → 命中的 annotation id（单点 hover 用） */
  hitTest(pt: Point): string | null;

  /** 矩形范围查询 → 命中的 annotation ids（框选用） */
  rangeSearch(rect: Rect): string[];

  /** 注册标注到空间索引 */
  registerAnnotations(annotations: readonly Annotation[]): void;

  /** 布局变化时通知失效 */
  invalidate(): void;

  /** 销毁，释放资源 */
  destroy(): void;
}

// ============================================================================
// 标注层接口
// ============================================================================

/** 标注框样式 */
export interface BoxStyle {
  strokeColor: string;
  /** rgba 半透明 */
  fillColor: string;
  strokeWidth: number;
  borderRadius?: number;
  labelColor?: string;
}

/** SVG 标注层 API */
export interface SVGLayerAPI {
  /** 在 rects 底部添加波浪线（跨行多段） */
  addWavyUnderline(id: string, rects: readonly DOMRect[], color: string): void;

  /** 添加矩形标注框 */
  addAnnotationBox(id: string, rect: DOMRect, style: BoxStyle): void;

  /** 在框内叠加文字标签 */
  addTextLabel(id: string, rect: DOMRect, text: string, color?: string): void;

  /** 控制高亮状态 */
  setHighlight(id: string, on: boolean, mode?: 'hover' | 'selected'): void;

  /** 显示/隐藏 resize 控制点 */
  showResizeHandles(id: string): void;
  hideResizeHandles(): void;

  /** 绘制/更新拖拽预览矩形 */
  showPreviewRect(rect: Rect): void;
  updatePreviewRect(rect: Rect): void;
  hidePreviewRect(): void;

  /** 移除单个标注 */
  remove(id: string): void;
  /** 清空所有标注 */
  clear(): void;
}

// ============================================================================
// 错误上报
// ============================================================================

/** 错误上报接口 */
export interface ErrorReporter {
  captureException(error: Error, context?: Record<string, unknown>): void;
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
  setUser(user: { id: string; [key: string]: unknown }): void;
}

// ============================================================================
// 分类颜色常量
// ============================================================================

/** 标注类型 → 颜色映射 */
export const CATEGORY_COLOR: Readonly<Record<AnnotationType, string>> = {
  'translation-paragraph': '#d9d9d9',
  'error-spelling': '#ff4d4f',
  'error-grammar': '#fa8c16',
  'error-punctuation': '#1890ff',
  'error-number': '#52c41a',
  'error-political': '#722ed1',
  'ocr-region': '#13c2c2',
  'ocr-field': '#1890ff',
} as const;

/** 错误类型 → CSS 类名映射 */
export const WAVY_CLASSES: Readonly<Record<string, string>> = {
  'error-spelling': 'wavy-red',
  'error-grammar': 'wavy-orange',
  'error-punctuation': 'wavy-blue',
  'error-number': 'wavy-green',
  'error-political': 'wavy-purple',
} as const;