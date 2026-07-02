// 模型：claude-sonnet-4-6
// useWordDiff hook 测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWordDiff } from '../../src/hooks/useWordDiff'

describe('useWordDiff', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock as any
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('挂载时自动 fetch 并把 result 写入 state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        srcTokens: ['a'],
        tgtTokens: ['b'],
        srcOffsets: [[0, 1]],
        tgtOffsets: [[0, 1]],
        ops: [{ op: 'delete', text: 'a' }, { op: 'insert', text: 'b' }],
        srcChars: 1, tgtChars: 1, ms: 1, langPair: ['zh', 'en'],
      }),
      text: async () => '',
      headers: new Headers(),
    })
    const { result } = renderHook(() =>
      useWordDiff({ taskId: 't1-fetch', segmentId: 's1', source: 'a', target: 'b' }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.result).not.toBeNull()
    expect(result.current.result?.ops.length).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/inspect/translate/word-diff')
    expect(JSON.parse(init.body).source).toBe('a')
  })

  it('空 source/target → 不 fetch，result 为 null', () => {
    const { result } = renderHook(() =>
      useWordDiff({ taskId: 't1-empty', source: '', target: '' }),
    )
    expect(result.current.result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('auto=false → 不自动 fetch，refresh() 才触发', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, json: async () => ({
        srcTokens: [], tgtTokens: [], srcOffsets: [], tgtOffsets: [],
        ops: [], srcChars: 0, tgtChars: 0, ms: 0, langPair: ['zh', 'en'],
      }),
      text: async () => '',
      headers: new Headers(),
    })
    const { result } = renderHook(() =>
      useWordDiff({ taskId: 't1-auto-off', source: 'a', target: 'b', auto: false }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { await result.current.refresh() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('非 ok 响应 → setError', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500, statusText: 'err',
      json: async () => ({ error: 'boom' }),
      text: async () => 'boom',
      headers: new Headers(),
    })
    const { result } = renderHook(() =>
      useWordDiff({ taskId: 't1-err', source: 'a', target: 'b' }),
    )
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.result).toBeNull()
  })

  it('缓存命中 → 不重复 fetch', async () => {
    const payload = {
      srcTokens: ['x'], tgtTokens: ['y'], srcOffsets: [[0, 1]], tgtOffsets: [[0, 1]],
      ops: [{ op: 'delete', text: 'x' }, { op: 'insert', text: 'y' }],
      srcChars: 1, tgtChars: 1, ms: 1, langPair: ['zh', 'en'],
    }
    fetchMock.mockResolvedValue({
      ok: true, status: 200, json: async () => payload,
      text: async () => '', headers: new Headers(),
    })
    const { result: r1 } = renderHook(() =>
      useWordDiff({ taskId: 't1-cache-x-y', source: 'x', target: 'y' }),
    )
    await waitFor(() => expect(r1.current.result).not.toBeNull())
    const { result: r2 } = renderHook(() =>
      useWordDiff({ taskId: 't1-cache-x-y', source: 'x', target: 'y' }),
    )
    // 第二个 hook 第一次同步 render 就应该命中缓存
    expect(r2.current.result).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
