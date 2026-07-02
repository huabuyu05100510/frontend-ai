/**
 * 性能监控工具
 *
 * 使用 performance.mark/measure 打点。
 * 生产环境自动跳过（零开销）。
 *
 * @module monitoring/performance
 */

declare const process: { env?: { NODE_ENV?: string } } | undefined;
const IS_PROD = typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production';

/** 埋点前缀 */
const PREFIX = 'mre:';

/**
 * 创建性能标记
 */
function mark(name: string): void {
  if (IS_PROD) return;
  try {
    performance.mark(PREFIX + name);
  } catch {
    // performance API 不可用时静默跳过
  }
}

/**
 * 测量两个标记之间的耗时
 *
 * @returns 耗时（ms），失败返回 null
 */
function measure(name: string, startMark: string, endMark: string): number | null {
  if (IS_PROD) return null;
  try {
    const measureName = PREFIX + name;
    performance.measure(measureName, PREFIX + startMark, PREFIX + endMark);
    const entries = performance.getEntriesByName(measureName, 'measure');
    if (entries.length > 0) {
      const duration = entries[entries.length - 1].duration;
      // 清理已完成的 measure
      performance.clearMeasures(measureName);
      return duration;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- 场景打点 ----

/** PDF 首屏渲染开始 */
export function markPdfFirstPageStart(): void { mark('pdf:first-page:start'); }
/** PDF 首屏渲染结束 */
export function markPdfFirstPageEnd(): void { mark('pdf:first-page:end'); }
/** 测量 PDF 首屏耗时 */
export function measurePdfFirstPage(): number | null {
  return measure('pdf:first-page', 'pdf:first-page:start', 'pdf:first-page:end');
}

/** OCR 识别开始 */
export function markOcrRecognizeStart(): void { mark('ocr:recognize:start'); }
/** OCR 识别结束 */
export function markOcrRecognizeEnd(): void { mark('ocr:recognize:end'); }
/** 测量 OCR 识别耗时 */
export function measureOcrRecognize(): number | null {
  return measure('ocr:recognize', 'ocr:recognize:start', 'ocr:recognize:end');
}

/** hitTest 开始 */
export function markHitTestStart(): void { mark('annotation:hitTest:start'); }
/** hitTest 结束 */
export function markHitTestEnd(): void { mark('annotation:hitTest:end'); }
/** 测量 hitTest 耗时 */
export function measureHitTest(): number | null {
  return measure('annotation:hitTest', 'annotation:hitTest:start', 'annotation:hitTest:end');
}

/** 翻译 API 调用开始 */
export function markTranslateStart(): void { mark('translate:api:start'); }
/** 翻译 API 调用结束 */
export function markTranslateEnd(): void { mark('translate:api:end'); }
/** 测量翻译耗时 */
export function measureTranslate(): number | null {
  return measure('translate:api', 'translate:api:start', 'translate:api:end');
}

/** 智检 API 调用开始 */
export function markInspectStart(): void { mark('inspect:api:start'); }
/** 智检 API 调用结束 */
export function markInspectEnd(): void { mark('inspect:api:end'); }
/** 测量智检耗时 */
export function measureInspect(): number | null {
  return measure('inspect:api', 'inspect:api:start', 'inspect:api:end');
}

/** 清除所有该模块的性能标记 */
export function clearAllMarks(): void {
  if (IS_PROD) return;
  try {
    performance.clearMarks(PREFIX);
    performance.clearMeasures(PREFIX);
  } catch {
    // 静默跳过
  }
}