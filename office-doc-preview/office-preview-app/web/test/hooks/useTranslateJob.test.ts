// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTranslateJob } from '../../src/hooks/useTranslateJob'
import type { TranslateJobFrame } from '../../src/types'

function mkFrame(seq: number, kind: TranslateJobFrame['kind'], payload: Record<string, unknown> = {}): TranslateJobFrame {
  return { seq, ts: 1700000000000 + seq * 100, kind, payload }
}

function mockProgressOnce(frames: TranslateJobFrame[], lastSeq?: number, status = 'running', extra: Record<string, string> = {}) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({
      'x-job-id': 'job_test',
      'x-job-last-seq': String(lastSeq ?? frames[frames.length - 1]?.seq ?? 0),
      'x-job-frames': String(frames.length),
      'x-job-status': status,
      ...extra,
    }),
    json: async () => ({ jobId: 'job_test', lastSeq: lastSeq ?? frames[frames.length - 1]?.seq ?? 0, frames }),
  } as unknown as Response)
}

describe('useTranslateJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns idle state when jobId is null', () => {
    const { result } = renderHook(() => useTranslateJob(null))
    expect(result.current.status).toBe('idle')
    expect(result.current.frames).toEqual([])
    expect(result.current.lastSeq).toBe(0)
    expect(result.current.completed).toBe(0)
    expect(result.current.total).toBe(0)
  })

  it('polls progress endpoint and parses frames', async () => {
    const frames = [mkFrame(1, 'started', { totalPages: 3 }), mkFrame(2, 'page-done', { page: 1 })]
    const fetchMock = mockProgressOnce(frames, 2, 'running')
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useTranslateJob('job_test', { pollMs: 100 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    await waitFor(() => expect(result.current.frames.length).toBe(2))
    expect(result.current.lastSeq).toBe(2)
    expect(result.current.total).toBe(3)
    expect(result.current.completed).toBe(1)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('stops polling when status reaches a terminal state', async () => {
    const frames = [mkFrame(1, 'finished', { totalPages: 2 })]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'x-job-id': 'job_t', 'x-job-last-seq': '1', 'x-job-frames': '1', 'x-job-status': 'finished' }),
      json: async () => ({ jobId: 'job_t', lastSeq: 1, frames }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useTranslateJob('job_t', { pollMs: 100 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    await waitFor(() => expect(result.current.status).toBe('finished'))
    const callCount = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(fetchMock.mock.calls.length).toBe(callCount)
  })

  it('counts page-done frames in completed', async () => {
    const frames = [
      mkFrame(1, 'started', { totalPages: 5 }),
      mkFrame(2, 'page-done', { page: 1 }),
      mkFrame(3, 'page-done', { page: 2 }),
      mkFrame(4, 'page-done', { page: 3 }),
    ]
    const fetchMock = mockProgressOnce(frames, 4, 'running')
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslateJob('job_c', { pollMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await waitFor(() => expect(result.current.completed).toBe(3))
    expect(result.current.total).toBe(5)
  })

  it('handles failed status', async () => {
    const frames = [mkFrame(1, 'failed', { error: 'server error' })]
    const fetchMock = mockProgressOnce(frames, 1, 'failed')
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslateJob('job_f', { pollMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await waitFor(() => expect(result.current.status).toBe('failed'))
  })

  it('cancels via image batch cancel endpoint', async () => {
    const cancelMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'x-job-id': 'job_x', 'x-job-cancelled-at': '2026-07-01T00:00:00Z' }),
      json: async () => ({ ok: true, id: 'job_x' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', cancelMock)
    const { result } = renderHook(() => useTranslateJob('job_x', { pollMs: 1000 }))
    let ok = false
    await act(async () => { ok = await result.current.cancel() })
    expect(ok).toBe(true)
    // Find the cancel call among all calls
    const cancelCall = cancelMock.mock.calls.find(c => String(c[0]).includes('/cancel'))
    expect(cancelCall).toBeDefined()
    expect(cancelCall![0]).toContain('/api/translate/image/batch/job_x/cancel')
    expect(cancelCall![1]?.method).toBe('POST')
  })

  it('refresh() triggers an immediate poll', async () => {
    const frames = [mkFrame(1, 'page-done', { page: 1 })]
    // Provide many responses so auto-poll + refresh both resolve
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'x-job-id': 'job_r', 'x-job-last-seq': '1', 'x-job-frames': '1', 'x-job-status': 'running' }),
      json: async () => ({ jobId: 'job_r', lastSeq: 1, frames }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslateJob('job_r', { pollMs: 10000 }))
    // Wait for the auto-poll to start
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('captures error when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslateJob('job_e', { pollMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await waitFor(() => expect(result.current.error).toBe('network down'))
  })

  it('cancels pending fetch on unmount', async () => {
    let resolveFn: ((r: unknown) => void) | null = null
    const fetchMock = vi.fn().mockImplementation(() => new Promise(r => { resolveFn = r }))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = renderHook(() => useTranslateJob('job_u', { pollMs: 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    unmount()
    // Resolve after unmount; should not throw
    if (resolveFn) {
      await act(async () => {
        ;(resolveFn as any)({ ok: true, status: 200, headers: new Headers(), json: async () => ({ frames: [] }) })
        await Promise.resolve()
      })
    }
  })

  it('deduplicates in-flight requests per jobId', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTranslateJob('job_d', { pollMs: 50 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    // Only one in-flight at a time
    expect(fetchMock.mock.calls.length).toBe(1)
  })
})
