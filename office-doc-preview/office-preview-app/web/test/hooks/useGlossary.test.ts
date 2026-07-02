// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGlossary } from '../../src/hooks/useGlossary'
import type { GlossaryTerm } from '../../src/types'

function mockFetchOk(body: unknown, extraHeaders: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: new Headers(extraHeaders),
    json: async () => body,
  } as unknown as Response)
}

function mockFetchErr(status: number, body: unknown = { error: 'nope' }) {
  return vi.fn().mockResolvedValue({
    ok: false, status, statusText: 'Error',
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response)
}

describe('useGlossary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads terms on mount when source/target provided', async () => {
    const terms: GlossaryTerm[] = [
      { id: 'g1', sourceLang: 'zh-CN', targetLang: 'en', source: '苹果', target: 'Apple' },
    ]
    const fetchMock = mockFetchOk({ items: terms }, { 'x-glossary-count': '1' })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.terms).toEqual(terms)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/translate/glossary')
    expect(fetchMock.mock.calls[0][0]).toContain('sourceLang=zh-CN')
  })

  it('add() POSTs and prepends to terms', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }), json: async () => ({ items: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-id': 'g2', 'x-glossary-hits': '1' }), json: async () => ({ id: 'g2', sourceLang: 'zh-CN', targetLang: 'en', source: '香蕉', target: 'Banana' }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let added: GlossaryTerm | null = null
    await act(async () => { added = await result.current.add('香蕉', 'Banana') })
    expect(added).not.toBeNull()
    expect(added!.id).toBe('g2')
    expect(result.current.terms[0].source).toBe('香蕉')
  })

  it('remove() DELETEs and filters terms', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '1' }), json: async () => ({ items: [{ id: 'g1', sourceLang: 'zh-CN', targetLang: 'en', source: '苹果', target: 'Apple' }] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-removed-id': 'g1' }), json: async () => ({ ok: true, id: 'g1' }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.terms.length).toBe(1))
    let ok = false
    await act(async () => { ok = await result.current.remove('g1') })
    expect(ok).toBe(true)
    expect(result.current.terms.length).toBe(0)
  })

  it('importCsv() sends multipart and returns counts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }), json: async () => ({ items: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-imported-count': '5', 'x-glossary-duplicates': '1' }), json: async () => ({ imported: 5, duplicates: 1 }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const file = new File(['source,target\n苹果,Apple\n'], 'terms.csv', { type: 'text/csv' })
    let res: { imported: number; duplicates: number } | null = null
    await act(async () => { res = await result.current.importCsv(file) })
    expect(res).not.toBeNull()
    expect(res!.imported).toBe(5)
    expect(res!.duplicates).toBe(1)
    const postCall = fetchMock.mock.calls.find(c => (c[1] as any)?.method === 'POST' && String(c[0]).includes('import'))
    expect(postCall).toBeDefined()
  })

  it('applyTo() replaces longest source first (basic substitution)', async () => {
    const fetchMock = vi.fn()
      // initial list (empty)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }), json: async () => ({ items: [] }) } as unknown as Response)
      // add 苹果公司
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-id': 'g1', 'x-glossary-hits': '1' }), json: async () => ({ id: 'g1', sourceLang: 'zh-CN', targetLang: 'en', source: '苹果公司', target: 'Apple Inc.' }) } as unknown as Response)
      // add 苹果
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-id': 'g2', 'x-glossary-hits': '1' }), json: async () => ({ id: 'g2', sourceLang: 'zh-CN', targetLang: 'en', source: '苹果', target: 'Apple' }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.add('苹果公司', 'Apple Inc.')
    })
    await act(async () => {
      await result.current.add('苹果', 'Apple')
    })
    await waitFor(() => expect(result.current.terms.length).toBe(2))
    const out = result.current.applyTo('我吃苹果公司苹果')
    expect(out).toContain('Apple')
    // longest-first: 苹果公司 should be replaced with Apple Inc. before 苹果 is considered
    expect(out).toContain('Apple Inc.')
  })

  it('handles fetch error gracefully', async () => {
    const fetchMock = mockFetchErr(500, { error: 'oops' })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('oops')
    expect(result.current.terms).toEqual([])
  })

  it('refresh() re-fetches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }), json: async () => ({ items: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '2' }), json: async () => ({ items: [{ id: 'a', sourceLang: 'zh-CN', targetLang: 'en', source: 'a', target: 'a' }, { id: 'b', sourceLang: 'zh-CN', targetLang: 'en', source: 'b', target: 'b' }] }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('zh-CN', 'en'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.terms.length).toBe(2))
  })

  it('skips network when sourceLang/targetLang are empty', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGlossary('', ''))
    await act(async () => { await result.current.refresh() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.terms).toEqual([])
  })
})
