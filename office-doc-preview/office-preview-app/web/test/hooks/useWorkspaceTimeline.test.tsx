// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWorkspaceTimeline, type TimelineEntry } from '../../src/hooks/useWorkspaceTimeline'

const mockEntries: TimelineEntry[] = [
  { id: 'tl_1', kind: 'upload', taskId: null, summary: 'A', ts: 1000 },
  { id: 'tl_2', kind: 'translate', taskId: 't_x', summary: 'B', ts: 2000 },
]

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response)
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let i = 0
  return vi.fn().mockImplementation(async () => {
    const r = responses[i++] ?? responses[responses.length - 1]
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: 'OK',
      json: async () => r.body,
    } as unknown as Response
  })
}

describe('useWorkspaceTimeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('load() returns parsed entries', async () => {
    const fetchMock = mockFetchOnce(200, { entries: mockEntries })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWorkspaceTimeline({ autoLoad: false }))
    await act(async () => {
      await result.current.load()
    })

    expect(result.current.entries).toEqual(mockEntries)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/workspace/timeline')
  })

  it('append() POSTs and prepends to entries', async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { ok: true, entry: { id: 'tl_99', kind: 'ocr', taskId: null, summary: 'OCR done', ts: 9999 } } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWorkspaceTimeline({ autoLoad: false }))
    let appended: TimelineEntry | null = null
    await act(async () => {
      appended = await result.current.append({ kind: 'ocr', summary: 'OCR done' })
    })

    expect(appended).not.toBeNull()
    expect(appended!.id).toBe('tl_99')
    expect(result.current.entries[0].id).toBe('tl_99')
    // POST endpoint
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspace/timeline')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('remove() DELETEs and filters entries', async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { entries: mockEntries } },     // initial load
      { status: 200, body: { ok: true, id: 'tl_1' } },    // delete tl_1
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWorkspaceTimeline({ autoLoad: true }))
    await waitFor(() => expect(result.current.entries.length).toBe(2))

    let ok = false
    await act(async () => {
      ok = await result.current.remove('tl_1')
    })
    expect(ok).toBe(true)
    expect(result.current.entries.length).toBe(1)
    expect(result.current.entries[0].id).toBe('tl_2')
    // DELETE endpoint
    const deleteCall = fetchMock.mock.calls.find(c => (c[1] as any)?.method === 'DELETE')
    expect(deleteCall).toBeDefined()
    expect(deleteCall![0]).toContain('/api/workspace/timeline/tl_1')
  })

  it('clear() empties entries', async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { entries: mockEntries } },  // initial load
      { status: 200, body: { ok: true, cleared: 2 } },  // clear
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWorkspaceTimeline({ autoLoad: true }))
    await waitFor(() => expect(result.current.entries.length).toBe(2))

    await act(async () => {
      await result.current.clear()
    })

    expect(result.current.entries).toEqual([])
  })

  it('load() with autoLoad=true fetches once on mount', async () => {
    const fetchMock = mockFetchOnce(200, { entries: mockEntries })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWorkspaceTimeline({ autoLoad: true }))
    await waitFor(() => expect(result.current.entries.length).toBe(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('error is captured when fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({ error: 'boom' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useWorkspaceTimeline({ autoLoad: false }))
    await act(async () => {
      await result.current.load()
    })

    expect(result.current.error).toBe('boom')
    expect(result.current.entries).toEqual([])
  })
})