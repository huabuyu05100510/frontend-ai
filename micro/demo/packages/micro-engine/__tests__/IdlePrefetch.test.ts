import { describe, expect, it, vi, afterEach } from 'vitest'
import { IdlePrefetch } from '../src/IdlePrefetch'

describe('IdlePrefetch 边界场景', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('同 url 只预取一次（去重）', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('requestIdleCallback', (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
      cb({ timeRemaining: () => 50, didTimeout: false })
      return 0
    })
    vi.stubGlobal('cancelIdleCallback', () => {})
    const p = new IdlePrefetch()
    p.prefetch(['/a.js', '/a.js', '/b.js'])
    expect(p.has('/a.js')).toBe(true)
    expect(p.has('/b.js')).toBe(true)
  })

  it('fetch 失败计入 misses，不抛错', async () => {
    vi.stubGlobal('requestIdleCallback', (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void) => {
      cb({ timeRemaining: () => 50, didTimeout: false })
      return 0
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fail'))))
    const p = new IdlePrefetch()
    p.prefetch(['/x.js'])
    await new Promise((r) => setTimeout(r, 0))
    expect(p.stats().misses).toBeGreaterThan(0)
  })

  it('cancel 后停止调度', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response()))
    vi.stubGlobal('fetch', fetchMock)
    let idleCalls = 0
    vi.stubGlobal('requestIdleCallback', () => {
      idleCalls++
      return 0
    })
    const p = new IdlePrefetch()
    p.prefetch(['/a.js'])
    p.cancel()
    expect(idleCalls).toBeLessThanOrEqual(1)
  })
})
