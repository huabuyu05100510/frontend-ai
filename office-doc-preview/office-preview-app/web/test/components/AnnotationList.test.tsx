// 模型：claude-sonnet-4-6
// AnnotationList — vertical list of annotations with filter pills
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AnnotationList } from '../../src/components/AnnotationList'
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

function mockJsonResponse(body: unknown): Response {
  return {
    ok: true, status: 200, statusText: 'OK', headers: new Headers(),
    json: async () => body, text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('AnnotationList', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders empty state when no annotations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items: [] })))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => {
      expect(screen.getByTestId('oa-annotation-list-empty')).toBeTruthy()
    })
    expect(screen.getByText(/暂无标注/)).toBeTruthy()
  })

  it('renders N annotation rows', async () => {
    const items = [
      makeAnnotation({ id: 'a1', kind: 'alt_trans', segmentId: 's_1' }),
      makeAnnotation({ id: 'a2', kind: 'align_fix', segmentId: 's_2' }),
      makeAnnotation({ id: 'a3', kind: 'seg_rating', segmentId: 's_3' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items })))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => {
      expect(screen.getByTestId('oa-annotation-list-row-a1')).toBeTruthy()
      expect(screen.getByTestId('oa-annotation-list-row-a2')).toBeTruthy()
      expect(screen.getByTestId('oa-annotation-list-row-a3')).toBeTruthy()
    })
  })

  it('filter pills work — clicking All shows all', async () => {
    const items = [
      makeAnnotation({ id: 'a1', kind: 'alt_trans' }),
      makeAnnotation({ id: 'a2', kind: 'align_fix' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items })))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-row-a1'))
    // All filter is default → both visible
    expect(screen.getByTestId('oa-annotation-list-row-a2')).toBeTruthy()
  })

  it('filter pills work — clicking alt_trans filter shows only alt_trans', async () => {
    const items = [
      makeAnnotation({ id: 'a1', kind: 'alt_trans' }),
      makeAnnotation({ id: 'a2', kind: 'align_fix' }),
      makeAnnotation({ id: 'a3', kind: 'alt_trans' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items })))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-row-a1'))
    fireEvent.click(screen.getByTestId('oa-annotation-list-filter-alt_trans'))
    await waitFor(() => {
      expect(screen.getByTestId('oa-annotation-list-row-a1')).toBeTruthy()
      expect(screen.queryByTestId('oa-annotation-list-row-a2')).toBeNull()
      expect(screen.getByTestId('oa-annotation-list-row-a3')).toBeTruthy()
    })
  })

  it('per-kind count badge shown on filter pill', async () => {
    const items = [
      makeAnnotation({ id: 'a1', kind: 'alt_trans' }),
      makeAnnotation({ id: 'a2', kind: 'alt_trans' }),
      makeAnnotation({ id: 'a3', kind: 'align_fix' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items })))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-row-a1'))
    const pill = screen.getByTestId('oa-annotation-list-filter-alt_trans')
    expect(pill.textContent).toMatch(/2/)
  })

  it('clicking a row invokes onSelect callback', async () => {
    const a1 = makeAnnotation({ id: 'a1', kind: 'alt_trans' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items: [a1] })))
    const onSelect = vi.fn()
    render(<AnnotationList taskId="t_xxx" onSelect={onSelect} />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-row-a1'))
    fireEvent.click(screen.getByTestId('oa-annotation-list-row-a1'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe('a1')
  })

  it('delete button on row invokes removeAnnotation', async () => {
    const a1 = makeAnnotation({ id: 'a1', kind: 'alt_trans' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [a1] }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, removed: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-row-a1'))
    const delBtn = screen.getByTestId('oa-annotation-list-row-a1-delete')
    fireEvent.click(delBtn)
    await waitFor(() => {
      expect(screen.queryByTestId('oa-annotation-list-row-a1')).toBeNull()
    })
  })

  it('segmentId prop filters to single segment', async () => {
    const items = [
      makeAnnotation({ id: 'a1', segmentId: 's_1' }),
      makeAnnotation({ id: 'a2', segmentId: 's_2' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items })))
    render(<AnnotationList taskId="t_xxx" segmentId="s_1" />)
    await waitFor(() => {
      expect(screen.getByTestId('oa-annotation-list-row-a1')).toBeTruthy()
      expect(screen.queryByTestId('oa-annotation-list-row-a2')).toBeNull()
    })
  })

  it('shows loading state initially', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))
    render(<AnnotationList taskId="t_xxx" />)
    expect(screen.getByTestId('oa-annotation-list-loading')).toBeTruthy()
  })

  it('shows error state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('fetch failed')))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => {
      expect(screen.getByTestId('oa-annotation-list-error')).toBeTruthy()
    })
    expect(screen.getByText(/fetch failed/)).toBeTruthy()
  })

  it('list has role="list" for accessibility', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items: [] })))
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-empty'))
    expect(screen.getByTestId('oa-annotation-list').getAttribute('role')).toBe('list')
  })

  it('logs filter change observability', async () => {
    const items = [
      makeAnnotation({ id: 'a1', kind: 'alt_trans' }),
      makeAnnotation({ id: 'a2', kind: 'alt_trans' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJsonResponse({ items })))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    render(<AnnotationList taskId="t_xxx" />)
    await waitFor(() => screen.getByTestId('oa-annotation-list-row-a1'))
    fireEvent.click(screen.getByTestId('oa-annotation-list-filter-alt_trans'))
    const logs = info.mock.calls.map(c => String(c[0]))
    expect(logs.some(l => l.includes('[translate-annotation') && l.includes('list filter') && l.includes('kind=alt_trans'))).toBe(true)
    info.mockRestore()
  })
})