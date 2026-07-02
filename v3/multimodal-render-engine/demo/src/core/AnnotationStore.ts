import type { Annotation, AnnotationType } from './types'
import type { EventBus } from './EventBus'

/**
 * 标注数据状态管理器
 * 内部使用 Map<id, Annotation> 存储，所有变更通过 EventBus 广播
 */
export class AnnotationStore {
  private store = new Map<string, Annotation>()

  constructor(private bus: EventBus) {}

  /** 批量加载标注，触发 ANNOTATIONS_LOADED 事件 */
  load(annotations: Annotation[]): void {
    this.store.clear()
    annotations.forEach(a => this.store.set(a.id, a))
    this.bus.emit({ type: 'ANNOTATIONS_LOADED', annotations })
  }

  /** 添加单个标注，触发 ANNOTATION_ADDED 事件 */
  add(annotation: Annotation): void {
    this.store.set(annotation.id, annotation)
    this.bus.emit({ type: 'ANNOTATION_ADDED', annotation })
  }

  /** 局部更新标注 */
  update(id: string, patch: Partial<Annotation>): void {
    const existing = this.store.get(id)
    if (!existing) return
    this.store.set(id, { ...existing, ...patch })
  }

  /** 删除标注 */
  remove(id: string): void {
    this.store.delete(id)
  }

  /** 按 id 查找 */
  getById(id: string): Annotation | undefined {
    return this.store.get(id)
  }

  /** 获取所有标注 */
  getAll(): Annotation[] {
    return Array.from(this.store.values())
  }

  /** 按类型过滤 */
  getByType(type: AnnotationType): Annotation[] {
    return this.getAll().filter(a => a.type === type)
  }

  /** 按状态过滤 */
  getByStatus(status: Annotation['status']): Annotation[] {
    return this.getAll().filter(a => a.status === status)
  }

  /**
   * 设置标注状态，同时触发对应事件
   */
  setStatus(id: string, status: Annotation['status']): void {
    this.update(id, { status })
    if (status === 'accepted') {
      this.bus.emit({ type: 'ANNOTATION_ACCEPT', id })
    } else if (status === 'ignored') {
      this.bus.emit({ type: 'ANNOTATION_IGNORE', id })
    }
  }

  /** 清空所有标注 */
  clear(): void {
    this.store.clear()
  }
}
