import type { KernelEvent } from './types'

type EventHandler<T extends KernelEvent> = (event: T) => void

/**
 * 类型安全的事件总线（发布/订阅）
 * 用于跨组件解耦通信
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler<KernelEvent>>>()

  /**
   * 发布事件
   */
  emit<T extends KernelEvent>(event: T): void {
    const set = this.handlers.get(event.type)
    if (!set) return
    set.forEach(handler => {
      try {
        handler(event)
      } catch (e) {
        console.error('[EventBus] handler error:', e)
      }
    })
  }

  /**
   * 订阅事件，返回取消订阅函数
   */
  on<T extends KernelEvent['type']>(
    type: T,
    handler: EventHandler<Extract<KernelEvent, { type: T }>>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    const set = this.handlers.get(type)!
    const h = handler as EventHandler<KernelEvent>
    set.add(h)
    return () => set.delete(h)
  }

  /**
   * 订阅一次性事件，触发后自动取消
   */
  once<T extends KernelEvent['type']>(
    type: T,
    handler: EventHandler<Extract<KernelEvent, { type: T }>>
  ): void {
    const unsub = this.on(type, (event) => {
      unsub()
      handler(event as Extract<KernelEvent, { type: T }>)
    })
  }

  /**
   * 清除所有订阅
   */
  clear(): void {
    this.handlers.clear()
  }
}
