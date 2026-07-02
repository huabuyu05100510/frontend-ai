/**
 * 事件总线 — 类型安全的发布订阅
 *
 * 跨组件事件通信核心，所有场景共用。
 * - 同一事件支持多个订阅者
 * - handler 异常不影响其他订阅者
 * - 返回 unsubscribe 函数用于清理
 *
 * @module core/EventBus
 */

import type { KernelEvent, KernelEventType } from './types';

/** 事件处理器类型 */
type EventHandler<T extends KernelEvent = KernelEvent> = (event: T) => void;

/**
 * 类型安全的事件总线
 *
 * @example
 * ```ts
 * const bus = new EventBus();
 * const unsub = bus.on('ANNOTATION_HOVER', ({ id }) => {
 *   console.log('hover:', id);
 * });
 * bus.emit({ type: 'ANNOTATION_HOVER', id: 'a1' });
 * unsub(); // 取消订阅
 * ```
 */
export class EventBus {
  private readonly handlers = new Map<KernelEventType, Set<EventHandler>>();

  /**
   * 发送事件
   *
   * 所有注册到该事件类型的 handler 都会被调用。
   * 单个 handler 抛异常不会影响其他 handler 执行。
   */
  emit<T extends KernelEvent>(event: T): void {
    const type = event.type as KernelEventType;
    const handlers = this.handlers.get(type);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(
          `[EventBus] handler error for event "${type}":`,
          error,
        );
        // 不 rethrow，确保其他 handler 继续执行
      }
    }
  }

  /**
   * 订阅事件
   *
   * @returns 取消订阅函数
   */
  on<T extends KernelEventType>(
    type: T,
    handler: EventHandler<Extract<KernelEvent, { type: T }>>,
  ): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }

    const typedHandler = handler as EventHandler;
    handlers.add(typedHandler);

    return () => {
      handlers?.delete(typedHandler);
      if (handlers && handlers.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  /**
   * 一次性订阅
   *
   * 事件触发一次后自动取消订阅。
   */
  once<T extends KernelEventType>(
    type: T,
    handler: EventHandler<Extract<KernelEvent, { type: T }>>,
  ): () => void {
    const wrapper: EventHandler = (event) => {
      unsubscribe();
      handler(event as Extract<KernelEvent, { type: T }>);
    };

    const unsubscribe = this.on(type, wrapper as EventHandler<Extract<KernelEvent, { type: T }>>);
    return unsubscribe;
  }

  /**
   * 清空所有订阅
   *
   * 通常在场景组件 unmount 时调用
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * 获取某事件类型的订阅者数量（调试用）
   */
  subscriberCount(type: KernelEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}