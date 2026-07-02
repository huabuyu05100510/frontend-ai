import type { EventMap } from './types'

type Handler<T> = (payload: T) => void
type Unsubscribe = () => void

/** Typed singleton event bus. Zero external dependencies. */
class TypedEventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>()

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    const set = this.handlers.get(event)!
    set.add(handler as Handler<unknown>)
    return () => set.delete(handler as Handler<unknown>)
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    const unsub = this.on(event, (payload) => {
      unsub()
      handler(payload)
    })
    return unsub
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.handlers.get(event)?.forEach(h => h(payload as unknown))
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>)
  }

  clear(): void {
    this.handlers.clear()
  }
}

export const EventBus = new TypedEventBus()
