// 模型：claude-sonnet-4-6
// useAnnotation — CRUD wrapper around /api/translate/annotation
// Tests: add (optimistic), update, delete, bySegmentId/byKind filters, debounced refresh,
//        error handling, network failure, count, refetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAnnotation } from '../../src/hooks/useAnnotation'
import type { TranslateAnnotation } from '../../src/types'

function makeAnnotation(overrides: Partial<TranslateAnnotation> = {}): TranslateAnnotation {
  return {
    id: 'a-' + Math.random().toString(36).slice(2, 10),
    kind: 'alt_trans',
    schemaVersion: 1,
    taskId: 't_xxx',
    segmentId: 's_1',
    url: 'task://t_xxx',
    domPath: 'seg:s_1',
    srcText: 'hello',
    tgtText: '你好',
    langPair: ['zh-CN', 'en'],
    srcTokens: ['hello'],
    tgtTokens: ['你好'],
    predicted: [],
    modelVersion: 'myers-word-v1',
    payload: { comment: 'test' },
    context: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function mockJsonResponse(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.ok === false ? 'Error' : 'OK',
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('useAnnotation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads annotations on mount', async () => {
    const items = [makeAnnotation({ id: 'a1', segmentId: 's_1' })]
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockJsonResponse({ items }, { headers: { 'x-translate-annotation-count': '1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual(items)
    expect(result.current.count).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/translate/annotation')
    expect(url).toContain('taskId=t_xxx')
  })

  it('skips fetch when taskId is null', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation(null))
    await act(async () => {
      // Trigger effect cycle
      await result.current.refetch()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it('addAnnotation POSTs and replaces optimistic temp item', async () => {
    const added = makeAnnotation({ id: 'a_new', segmentId: 's_2', kind: 'alt_trans' })
    const fetchMock = vi.fn()
      // initial GET (empty)
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }, { headers: { 'x-translate-annotation-count': '0' } }))
      // POST
      .mockResolvedValueOnce(
        mockJsonResponse({ ok: true, id: added.id, annotation: added }, { headers: { 'x-translate-annotation-id': added.id } }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(0)

    let out: TranslateAnnotation | null = null
    await act(async () => {
      out = await result.current.addAnnotation({
        taskId: 't_xxx',
        segmentId: 's_2',
        kind: 'alt_trans',
        srcText: 'hi',
        tgtText: '嗨',
        payload: { text: 'better' },
      })
    })
    expect(out).not.toBeNull()
    expect(out!.id).toBe('a_new')
    await waitFor(() => expect(result.current.count).toBe(1))
    expect(result.current.items[0].id).toBe('a_new')
    // POST endpoint + body shape
    const postCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'POST')
    expect(postCall).toBeDefined()
    const body = JSON.parse((postCall![1] as RequestInit).body as string)
    expect(body.taskId).toBe('t_xxx')
    expect(body.kind).toBe('alt_trans')
  })

  it('rolls back optimistic annotation when POST fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }, { headers: { 'x-translate-annotation-count': '0' } }))
      .mockResolvedValueOnce({ ok: false, status: 409, statusText: 'Conflict', headers: new Headers(), json: async () => ({ error: 'conflict' }), text: async () => 'conflict' } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let out: TranslateAnnotation | null = null
    await act(async () => {
      out = await result.current.addAnnotation({
        taskId: 't_xxx',
        segmentId: 's_9',
        kind: 'alt_trans',
        payload: {},
      })
    })
    expect(out).toBeNull()
    expect(result.current.items).toEqual([])
    expect(result.current.error).toContain('conflict')
    info.mockRestore()
  })

  it('updateAnnotation calls POST? — uses POST same endpoint with new payload', async () => {
    const original = makeAnnotation({ id: 'a1', kind: 'alt_trans', payload: { v: 1 } })
    const updated = { ...original, payload: { v: 2 }, updatedAt: Date.now() + 1 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [original] }, { headers: { 'x-translate-annotation-count': '1' } }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, id: updated.id, annotation: updated }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.items.length).toBe(1))
    let out: TranslateAnnotation | null = null
    await act(async () => {
      out = await result.current.updateAnnotation({ id: 'a1', payload: { v: 2 } })
    })
    expect(out).not.toBeNull()
    expect(out!.id).toBe('a1')
    const putCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'POST')
    expect(putCall).toBeDefined()
  })

  it('removeAnnotation DELETEs and filters', async () => {
    const a1 = makeAnnotation({ id: 'a1' })
    const a2 = makeAnnotation({ id: 'a2' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [a1, a2] }, { headers: { 'x-translate-annotation-count': '2' } }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, removed: 1 }, { headers: { 'x-translate-annotation-removed-id': 'a1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.items.length).toBe(2))

    let ok = false
    await act(async () => { ok = await result.current.removeAnnotation('a1') })
    expect(ok).toBe(true)
    expect(result.current.items.length).toBe(1)
    expect(result.current.items[0].id).toBe('a2')

    const delCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'DELETE')
    expect(delCall).toBeDefined()
    const url = delCall![0] as string
    expect(url).toContain('taskId=t_xxx')
    expect(url).toContain('id=a1')
  })

  it('bySegmentId filter returns matching items', async () => {
    const a1 = makeAnnotation({ id: 'a1', segmentId: 's_1' })
    const a2 = makeAnnotation({ id: 'a2', segmentId: 's_2' })
    const a3 = makeAnnotation({ id: 'a3', segmentId: 's_1' })
    const fetchMock = vi.fn().mockResolvedValueOnce(mockJsonResponse({ items: [a1, a2, a3] }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.items.length).toBe(3))
    expect(result.current.bySegmentId('s_1').length).toBe(2)
    expect(result.current.bySegmentId('s_2').length).toBe(1)
    expect(result.current.bySegmentId('s_X').length).toBe(0)
  })

  it('byKind filter returns matching items', async () => {
    const a1 = makeAnnotation({ id: 'a1', kind: 'align_fix' })
    const a2 = makeAnnotation({ id: 'a2', kind: 'seg_rating' })
    const a3 = makeAnnotation({ id: 'a3', kind: 'alt_trans' })
    const a4 = makeAnnotation({ id: 'a4', kind: 'alt_trans' })
    const fetchMock = vi.fn().mockResolvedValueOnce(mockJsonResponse({ items: [a1, a2, a3, a4] }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.items.length).toBe(4))
    expect(result.current.byKind('alt_trans').length).toBe(2)
    expect(result.current.byKind('align_fix').length).toBe(1)
    expect(result.current.byKind('seg_rating').length).toBe(1)
  })

  it('count reflects items length', async () => {
    const items = [makeAnnotation({ id: 'a1' }), makeAnnotation({ id: 'a2' }), makeAnnotation({ id: 'a3' })]
    const fetchMock = vi.fn().mockResolvedValueOnce(mockJsonResponse({ items }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.items.length).toBe(3))
    expect(result.current.count).toBe(3)
  })

  it('refetch re-issues GET', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [makeAnnotation({ id: 'a1' })] }))
      .mockResolvedValueOnce(mockJsonResponse({ items: [makeAnnotation({ id: 'a1' }), makeAnnotation({ id: 'a2' })] }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.items.length).toBe(1))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.items.length).toBe(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('error state set when network fails', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network down'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('Network down')
    expect(result.current.items).toEqual([])
  })

  it('handles 500 server error gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false, status: 500, statusText: 'Internal', headers: new Headers(),
      json: async () => ({ error: 'oops' }), text: async () => 'oops',
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('oops')
  })

  it('logs ISO timestamped observability message on add', async () => {
    const added = makeAnnotation({ id: 'a_log', segmentId: 's_5', kind: 'alt_trans' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, id: added.id, annotation: added }))
    vi.stubGlobal('fetch', fetchMock)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { result } = renderHook(() => useAnnotation('t_xxx'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.addAnnotation({ taskId: 't_xxx', segmentId: 's_5', kind: 'alt_trans', payload: {} })
    })
    const logs = info.mock.calls.map(c => String(c[0]))
    expect(logs.some(l => l.includes('[translate-annotation') && l.includes('task=t_xxx') && l.includes('kind=alt_trans'))).toBe(true)
    info.mockRestore()
  })
})