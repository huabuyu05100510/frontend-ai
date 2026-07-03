import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ResourceLoader } from '../src/ResourceLoader'
import type { ParseContext, RumSink } from '../src/types'

const rum: RumSink = {
  track: vi.fn(),
  metric: vi.fn(),
  error: vi.fn(),
}

const ctx: ParseContext = { appName: 'app', rum }

describe('ResourceLoader 边界场景', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('HTTP 404 → 返回 LoadFailure 且上报 RUM', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))))
    const loader = new ResourceLoader({}, rum.error.bind(rum))
    const result = await loader.load('/broken', ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.error.message).toMatch(/HTTP 404/)
    }
    expect(rum.error).toHaveBeenCalled()
  })

  it('fetch 抛错 → 捕获为 LoadFailure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    const loader = new ResourceLoader({}, rum.error.bind(rum))
    const result = await loader.load('/x', ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('network down')
  })

  it('beforeParse hook 注入正确（SDK 模式）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html><head></head><body>hi</body></html>', { status: 200 }))),
    )
    const beforeParse = vi.fn()
    const loader = new ResourceLoader({ beforeParse }, rum.error.bind(rum))
    const result = await loader.load('/ok', ctx)
    expect(result.ok).toBe(true)
    expect(beforeParse).toHaveBeenCalledTimes(1)
    expect(beforeParse.mock.calls[0][0]).toBeInstanceOf(Document)
  })

  it('beforeParse hook 抛错 → 不阻塞主流程', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html><body>x</body></html>', { status: 200 }))),
    )
    const failingHook = vi.fn(() => {
      throw new Error('SDK inject fail')
    })
    const loader = new ResourceLoader({ beforeParse: failingHook }, rum.error.bind(rum))
    const result = await loader.load('/ok', ctx)
    // hook 失败但 load 仍 ok
    expect(result.ok).toBe(true)
    expect(rum.error).toHaveBeenCalled()
  })

  it('inject 时 iframe document 不可用 → 抛错', () => {
    const loader = new ResourceLoader({}, rum.error.bind(rum))
    const dom = new DOMParser().parseFromString('<html><body>x</body></html>', 'text/html')
    const fakeIframe = {
      contentDocument: null,
      contentWindow: null,
    } as unknown as HTMLIFrameElement
    expect(() => loader.inject(fakeIframe, dom, ctx)).toThrow()
  })
})
