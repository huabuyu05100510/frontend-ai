// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTranslationMemory } from '../../src/hooks/useTranslationMemory'
import type { TmEntry } from '../../src/types'

function okResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true, status: 200,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response
}

describe('useTranslationMemory', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads TM entries on mount', async () => {
    const entries: TmEntry[] = [
      { id: 'tm1', sourceLang: 'zh-CN', targetLang: 'en', source: '你好', target: 'Hello' },
    ]
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse({ items: entries }, { 'x-tm-count': '1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationMemory('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toEqual(entries)
  })

  it('add() POSTs and prepends entry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ items: [] }, { 'x-tm-count': '0' }))
      .mockResolvedValueOnce(okResponse({ id: 'tm2', sourceLang: 'zh-CN', targetLang: 'en', source: '世界', target: 'World', score: 1 }, { 'x-tm-id': 'tm2', 'x-tm-score': '1.000' }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationMemory('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let added: TmEntry | null = null
    await act(async () => { added = await result.current.add('世界', 'World') })
    expect(added).not.toBeNull()
    expect(added!.id).toBe('tm2')
    expect(result.current.entries[0].source).toBe('世界')
  })

  it('remove() DELETEs and filters entries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ items: [{ id: 'tm1', sourceLang: 'zh-CN', targetLang: 'en', source: '你好', target: 'Hello' }] }, { 'x-tm-count': '1' }))
      .mockResolvedValueOnce(okResponse({ ok: true, id: 'tm1' }, { 'x-tm-removed-id': 'tm1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationMemory('zh-CN', 'en'))
    await waitFor(() => expect(result.current.entries.length).toBe(1))
    let ok = false
    await act(async () => { ok = await result.current.remove('tm1') })
    expect(ok).toBe(true)
    expect(result.current.entries).toEqual([])
  })

  it('lookup() debounces and filters by threshold', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ items: [] }, { 'x-tm-count': '0' })) // initial
      .mockResolvedValueOnce(okResponse({ items: [{ id: 'tmA', sourceLang: 'zh-CN', targetLang: 'en', source: '你好', target: 'Hello', score: 0.9 }] }, { 'x-tm-count': '1', 'x-tm-match-score': '0.900' }))
      .mockResolvedValueOnce(okResponse({ items: [] }, { 'x-tm-count': '0' }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationMemory('zh-CN', 'en'))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    let hits: TmEntry[] = []
    await act(async () => {
      const p = result.current.lookup('你好', 0.5)
      await vi.advanceTimersByTimeAsync(300)
      hits = await p
    })
    expect(hits.length).toBe(1)
    expect(hits[0].source).toBe('你好')
    // threshold 0.99 should filter
    let hits2: TmEntry[] = []
    await act(async () => {
      const p = result.current.lookup('你好', 0.99)
      await vi.advanceTimersByTimeAsync(300)
      hits2 = await p
    })
    expect(hits2.length).toBe(0)
    vi.useRealTimers()
  })

  it('handles fetch error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false, status: 500, statusText: 'Error', headers: new Headers(),
      json: async () => ({ error: 'tm fail' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationMemory('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('tm fail')
  })

  it('refresh() re-fetches entries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ items: [] }, { 'x-tm-count': '0' }))
      .mockResolvedValueOnce(okResponse({ items: [{ id: 'x', sourceLang: 'zh-CN', targetLang: 'en', source: 's', target: 't' }] }, { 'x-tm-count': '1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslationMemory('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.entries.length).toBe(1))
  })
})
