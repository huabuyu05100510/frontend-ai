/**
 * 标注状态管理 — 全局标注数据存储
 *
 * 内部使用 Map 存储，所有变更通过 EventBus 广播。
 * 支持 CRUD、批量操作、置信度过滤、页面范围查询、撤销。
 *
 * @module core/AnnotationStore
 */

import type {
  Annotation,
  AnnotationStatus,
  AnnotationType,
  FieldConfig,
} from './types';
import type { EventBus } from './EventBus';

/** 撤销栈最大深度 */
const MAX_UNDO_STACK = 20;

/** 变更历史记录 */
interface HistoryEntry {
  action: 'accept' | 'ignore' | 'batch_accept' | 'batch_ignore';
  annotationId: string;
  prevStatus: AnnotationStatus;
  timestamp: number;
}

/**
 * 标注数据状态管理
 *
 * @example
 * ```ts
 * const store = new AnnotationStore(eventBus);
 * store.load(annotations);
 * store.setStatus('a1', 'accepted');
 * store.undo(); // 撤销
 * ```
 */
export class AnnotationStore {
  private readonly annotations = new Map<string, Annotation>();
  private readonly undoStack: HistoryEntry[] = [];

  constructor(private readonly eventBus: EventBus) {}

  // ========================================================================
  // 数据加载
  // ========================================================================

  /**
   * 批量加载标注
   *
   * 触发 ANNOTATIONS_LOADED 事件。
   */
  load(annotations: readonly Annotation[]): void {
    this.annotations.clear();
    this.undoStack.length = 0;

    for (const ann of annotations) {
      this.annotations.set(ann.id, { ...ann });
    }

    this.eventBus.emit({
      type: 'ANNOTATIONS_LOADED',
      annotations: annotations.map(a => ({ ...a })),
    });
  }

  // ========================================================================
  // CRUD
  // ========================================================================

  /** 添加单个标注 */
  add(annotation: Annotation): void {
    this.annotations.set(annotation.id, { ...annotation });
  }

  /** 更新标注字段 */
  update(id: string, patch: Partial<Annotation>): void {
    const existing = this.annotations.get(id);
    if (!existing) {
      console.warn(`[AnnotationStore] update: annotation "${id}" not found`);
      return;
    }
    this.annotations.set(id, { ...existing, ...patch });
  }

  /** 移除标注 */
  remove(id: string): void {
    this.annotations.delete(id);
  }

  // ========================================================================
  // 查询
  // ========================================================================

  /** 按 ID 查询 */
  getById(id: string): Annotation | undefined {
    return this.annotations.get(id);
  }

  /** 获取全部标注 */
  getAll(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  /** 按类型查询 */
  getByType(type: AnnotationType): Annotation[] {
    return this.getAll().filter(a => a.type === type);
  }

  /** 按状态查询 */
  getByStatus(status: AnnotationStatus): Annotation[] {
    return this.getAll().filter(a => a.status === status);
  }

  /** 按置信度过滤（≤ threshold） */
  getByConfidence(threshold: number): Annotation[] {
    return this.getAll().filter(
      a => a.content.confidence !== undefined && a.content.confidence <= threshold,
    );
  }

  /** 按页面范围查询（仅 page position 类型） */
  getByPageRange(startPage: number, endPage: number): Annotation[] {
    return this.getAll().filter(a => {
      if (a.position.kind !== 'page') return false;
      return a.position.page >= startPage && a.position.page <= endPage;
    });
  }

  // ========================================================================
  // 状态变更
  // ========================================================================

  /**
   * 设置单个标注状态
   *
   * 触发对应事件（ANNOTATION_ACCEPT / ANNOTATION_IGNORE）。
   * 记录到撤销栈。
   */
  setStatus(id: string, status: AnnotationStatus): void {
    const annotation = this.annotations.get(id);
    if (!annotation) {
      console.warn(`[AnnotationStore] setStatus: annotation "${id}" not found`);
      return;
    }

    const prevStatus = annotation.status;
    annotation.status = status;
    this.annotations.set(id, annotation);

    // 记录历史
    this.pushHistory({
      action: status === 'accepted' ? 'accept' : 'ignore',
      annotationId: id,
      prevStatus,
      timestamp: Date.now(),
    });

    // 广播事件
    if (status === 'accepted') {
      this.eventBus.emit({ type: 'ANNOTATION_ACCEPT', id });
    } else if (status === 'ignored') {
      this.eventBus.emit({ type: 'ANNOTATION_IGNORE', id });
    }
  }

  /**
   * 批量设置状态
   *
   * 为每个标注触发对应事件，但不触发 ANNOTATIONS_LOADED。
   */
  setStatusBatch(ids: readonly string[], status: AnnotationStatus): void {
    for (const id of ids) {
      const annotation = this.annotations.get(id);
      if (!annotation) continue;

      const prevStatus = annotation.status;
      annotation.status = status;
      this.annotations.set(id, annotation);

      this.pushHistory({
        action: status === 'accepted' ? 'batch_accept' : 'batch_ignore',
        annotationId: id,
        prevStatus,
        timestamp: Date.now(),
      });

      if (status === 'accepted') {
        this.eventBus.emit({ type: 'ANNOTATION_ACCEPT', id });
      } else if (status === 'ignored') {
        this.eventBus.emit({ type: 'ANNOTATION_IGNORE', id });
      }
    }
  }

  // ========================================================================
  // 撤销
  // ========================================================================

  /**
   * 撤销上一次 setStatus / setStatusBatch 操作
   *
   * @returns true 表示撤销成功，false 表示无历史
   */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;

    const annotation = this.annotations.get(entry.annotationId);
    if (annotation) {
      annotation.status = entry.prevStatus;
      this.annotations.set(entry.annotationId, annotation);
    }

    return true;
  }

  /**
   * 获取变更历史（最近 20 条）
   */
  getHistory(): readonly HistoryEntry[] {
    return [...this.undoStack];
  }

  // ========================================================================
  // 清理
  // ========================================================================

  /** 清空所有数据 */
  clear(): void {
    this.annotations.clear();
    this.undoStack.length = 0;
  }

  /** 标注总数 */
  get size(): number {
    return this.annotations.size;
  }

  // ========================================================================
  // 内部
  // ========================================================================

  private pushHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    // FIFO 淘汰
    while (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
  }
}