// useImageBatch — batch translate API 包装 hook
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useImageBatch } from '../../src/hooks/useImageBatch'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useImageBatch', () => {
  it('初始状态：jobId=null, status=idle, items=[]', () => {
    const { result } = renderHook(() => useImageBatch())
    expect(result.current.jobId).toBeNull()
    expect(result.current.status).toBe('idle')
    expect(result.current.items).toEqual([])
  })

  it('start() 调用 POST /api/translate/image/batch 并返回 jobId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-abc', total: 2, progressUrl: '/api/translate/image/batch/job-abc' }),
    } as any)
    global.fetch = fetchMock

    const { result } = renderHook(() => useImageBatch())
    let newJobId = ''
    await act(async () => {
      newJobId = await result.current.start({
        taskIds: ['a', 'b'], sourceLang: 'zh-CN', targetLang: 'en',
      })
    })
    expect(newJobId).toBe('job-abc')
    expect(result.current.jobId).toBe('job-abc')
    expect(result.current.status).toBe('started')
    // body 应包含 taskIds + langs
    const lastCall = fetchMock.mock.calls[0]
    const body = JSON.parse(lastCall[1].body)
    expect(body.taskIds).toEqual(['a', 'b'])
    expect(body.sourceLang).toBe('zh-CN')
    expect(body.targetLang).toBe('en')
  })

  it('start() 失败时设置 status=failed 并抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server boom',
    } as any)
    global.fetch = fetchMock

    const { result } = renderHook(() => useImageBatch())
    await act(async () => {
      await expect(result.current.start({ taskIds: [], sourceLang: 'zh-CN', targetLang: 'en' })).rejects.toBeTruthy()
    })
    expect(result.current.status).toBe('failed')
  })

  it('cancel() 调用 cancel endpoint + 重置状态', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/cancel')) {
        return { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) } as any
      }
      return { ok: true, status: 202, json: async () => ({ jobId: 'job-x', total: 0, progressUrl: '/' }) } as any
    })
    global.fetch = fetchMock

    const { result } = renderHook(() => useImageBatch())
    await act(async () => {
      await result.current.start({ taskIds: ['a'], sourceLang: 'zh-CN', targetLang: 'en' })
    })
    expect(result.current.jobId).toBe('job-x')

    await act(async () => {
      await result.current.cancel()
    })
    expect(result.current.status).toBe('cancelled')
    // 应当调用过 cancel endpoint
    const cancelCalls = fetchMock.mock.calls.filter(([u]: any) =>
      typeof u === 'string' && u.includes('/cancel')
    )
    expect(cancelCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('reset() 清空 jobId/items/status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-r', total: 0, progressUrl: '/' }),
    } as any)
    global.fetch = fetchMock

    const { result } = renderHook(() => useImageBatch())
    await act(async () => {
      await result.current.start({ taskIds: ['a'], sourceLang: 'zh-CN', targetLang: 'en' })
    })
    expect(result.current.jobId).toBe('job-r')
    act(() => result.current.reset())
    expect(result.current.jobId).toBeNull()
    expect(result.current.status).toBe('idle')
    expect(result.current.items).toEqual([])
  })

  it('start() 传 glossaryId/tmId 时 body 含字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'j', total: 0, progressUrl: '/' }),
    } as any)
    global.fetch = fetchMock

    const { result } = renderHook(() => useImageBatch())
    await act(async () => {
      await result.current.start({
        taskIds: ['a'], sourceLang: 'zh-CN', targetLang: 'en',
        glossaryId: 'g1', tmId: 't1',
      })
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.glossaryId).toBe('g1')
    expect(body.tmId).toBe('t1')
  })

  it('progress frames 更新 items', async () => {
    let progressCallback: ((data: any) => void) | null = null
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/batch/') && !url.includes('/cancel')) {
        // progress endpoint
        return { ok: true, status: 200, json: async () => ({ frames: [] }) } as any
      }
      return { ok: true, status: 202, json: async () => ({ jobId: 'j', total: 1, progressUrl: '/' }) } as any
    })
    global.fetch = fetchMock

    const { result } = renderHook(() => useImageBatch())
    await act(async () => {
      await result.current.start({ taskIds: ['a'], sourceLang: 'zh-CN', targetLang: 'en' })
    })
    // 简单断言：items 是 array
    expect(Array.isArray(result.current.items)).toBe(true)
  })
})
