/**
 * 多模态 AI 渲染引擎 — 入口
 *
 * 导出所有场景组件、核心类型和工具函数。
 *
 * @module index
 */

// ---- 场景组件 ----
export { DualColumnLayout } from './scenes/translation/DualColumnLayout';
export { InspectionText } from './scenes/inspection/InspectionText';
export { InspectionDocument } from './scenes/inspection/InspectionDocument';
export { OCRGeneralView } from './scenes/ocr-general/OCRGeneralView';
export { TemplateEditor } from './scenes/ocr-custom/TemplateEditor';

// ---- 核心类型 ----
export type {
  Annotation,
  AnnotationType,
  AnnotationStatus,
  AnnotationContent,
  Position,
  PixelPosition,
  PagePosition,
  OffsetPosition,
  Rect,
  Point,
  Size,
  InteractionState,
  KernelEvent,
  KernelEventType,
  FieldConfig,
  FieldDataType,
  OCRTemplate,
  Paragraph,
  ParagraphMapping,
  TextItem,
  TranslationResult,
  OCRResult,
  CoordAdapter,
  SVGLayerAPI,
  BoxStyle,
  ErrorReporter,
  CATEGORY_COLOR,
  WAVY_CLASSES,
} from './core/types';

// ---- 核心引擎 ----
export { EventBus } from './core/EventBus';
export { AnnotationStore } from './core/AnnotationStore';
export { AnnotationStateMachine } from './core/StateMachine';

// ---- 适配器 ----
export { ImageCoordAdapter } from './adapters/ImageCoordAdapter';
export { DocumentCoordAdapter } from './adapters/DocumentCoordAdapter';
export { TextCoordAdapter } from './adapters/TextCoordAdapter';

// ---- 渲染器 ----
export { SVGLayer } from './layers/SVGLayer';
export { ImageRenderer } from './renderers/ImageRenderer';

// ---- 工具函数 ----
export { normalizeRect, rectArea, scaleRect, rectToClientRect, clientPointToRelative, rectsOverlap, clampRectSize, calcResizedRect, calcMovedRect } from './utils/coord';
export { createSVGElement, setAttrs, wavyPathD, createWavyPath, createAnnotationRect, createTextLabel, createResizeHandle, createPreviewRect } from './utils/svg';
export { measureTextWidth, calcScaleXCorrection } from './utils/measure';
export { SpatialIndex } from './utils/rtree';

// ---- 通用组件 ----
export { ErrorBoundary } from './components/ErrorBoundary';
export { LoadingSkeleton } from './components/LoadingSkeleton';
export { EmptyState } from './components/EmptyState';
export { ToastContainer, toast } from './components/Toast';

// ---- 场景子模块 ----
export { ScrollSyncBridge } from './scenes/translation/ScrollSyncBridge';
export { ParagraphMapper } from './scenes/translation/ParagraphMapper';
export { buildTextLayer, destroyTextLayer } from './scenes/translation/TextLayer';
export { ErrorPanel } from './scenes/inspection/ErrorPanel';
export { TextResultPanel } from './scenes/ocr-general/TextResultPanel';
export { DrawTool } from './scenes/ocr-custom/DrawTool';
export { ConfigPanel } from './scenes/ocr-custom/ConfigPanel';
export { TemplateManager } from './scenes/ocr-custom/TemplateManager';

// ---- Hooks ----
export { useAnnotationSync } from './hooks/useAnnotationSync';
export { useKeyboardNav } from './hooks/useKeyboardNav';
export { useAutoSave } from './hooks/useAutoSave';

// ---- 监控 ----
export {
  markPdfFirstPageStart, markPdfFirstPageEnd, measurePdfFirstPage,
  markOcrRecognizeStart, markOcrRecognizeEnd, measureOcrRecognize,
  markHitTestStart, markHitTestEnd, measureHitTest,
  clearAllMarks,
} from './monitoring/performance';
export {
  setReporter, captureException, captureMessage,
  startGlobalErrorListener,
} from './monitoring/error-tracking';