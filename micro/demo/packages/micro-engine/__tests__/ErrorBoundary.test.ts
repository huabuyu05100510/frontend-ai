import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ErrorBoundary, defaultFallback } from '../src/ErrorBoundary'
import type { AppManifest, RumSink } from '../src/types'

const rum: RumSink = { track: vi.fn(), metric: vi.fn(), error: vi.fn() }

describe('ErrorBoundary 边界场景', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('handle 调用降级 handler 并计数', () => {
    const handler = vi.fn()
    const b = new ErrorBoundary(rum, handler)
    const app: AppManifest = {
      name: 'broken',
      entryUrl: '/broken',
      route: '/broken',
      framework: 'native',
    }
    const iframe = {} as HTMLIFrameElement
    b.handle({ app, err: new Error('x'), iframe })
    b.handle({ app, err: new Error('y'), iframe })
    expect(handler).toHaveBeenCalledTimes(2)
    expect(b.count()).toBe(2)
    expect(rum.metric).toHaveBeenCalledWith('fallback.count', 2)
  })

  it('defaultFallback：没 mpaFallbackUrl 时不跳转（避免死循环）', () => {
    const iframe = { contentWindow: { location: { replace: vi.fn() } } } as unknown as HTMLIFrameElement
    const app: AppManifest = { name: 'b', entryUrl: '/b', route: '/b', framework: 'native' }
    expect(() => defaultFallback({ app, err: new Error('x'), iframe })).not.toThrow()
    expect((iframe.contentWindow as any).location.replace).not.toHaveBeenCalled()
  })

  it('defaultFallback：有 mpaFallbackUrl 时调 location.replace', () => {
    const replace = vi.fn()
    const iframe = {
      contentWindow: { location: { replace } },
    } as unknown as HTMLIFrameElement
    const app: AppManifest = {
      name: 'b',
      entryUrl: '/b',
      route: '/b',
      framework: 'native',
      mpaFallbackUrl: '/legacy/b',
    }
    defaultFallback({ app, err: new Error('404'), iframe })
    expect(replace).toHaveBeenCalledWith('/legacy/b')
  })

  it('handler 自身抛错被吞掉（不让 fallback 链路挂）', () => {
    const badHandler = () => {
      throw new Error('handler bomb')
    }
    const b = new ErrorBoundary(rum, badHandler)
    const app: AppManifest = { name: 'b', entryUrl: '/b', route: '/b', framework: 'native' }
    expect(() => b.handle({ app, err: new Error('x'), iframe: {} as HTMLIFrameElement })).not.toThrow()
    expect(rum.error).toHaveBeenCalledTimes(2) // 原错 + handler 错
  })
})
