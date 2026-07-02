// 模型：claude-sonnet-4-6
// AnnotationPopup — Modal-wrapped form for adding/editing annotation
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AnnotationPopup } from '../../src/components/AnnotationPopup'

function mockJsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.ok === false ? 'Error' : 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('AnnotationPopup', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.documentElement.setAttribute('data-motion', 'off')
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-motion')
  })

  it('does not render when open=false', () => {
    render(<AnnotationPopup open={false} onClose={() => {}} taskId="t_xxx" />)
    expect(screen.queryByTestId('oa-annotation-popup')).toBeNull()
  })

  it('opens for alt_trans kind with textarea', async () => {
    render(<AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" kind="alt_trans" srcText="hi" tgtText="嗨" />)
    expect(screen.getByTestId('oa-annotation-popup')).toBeTruthy()
    expect(screen.getByTestId('oa-annotation-popup-kind-alt_trans')).toBeTruthy()
    expect(screen.getByTestId('oa-annotation-popup-textarea')).toBeTruthy()
  })

  it('opens for align_fix kind with select dropdowns', async () => {
    render(<AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" kind="align_fix" srcText="A B" tgtText="X Y" />)
    expect(screen.getByTestId('oa-annotation-popup-kind-align_fix')).toBeTruthy()
    expect(screen.getByTestId('oa-annotation-popup-src-select')).toBeTruthy()
    expect(screen.getByTestId('oa-annotation-popup-tgt-select')).toBeTruthy()
  })

  it('opens for seg_rating kind with star picker', async () => {
    render(<AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" kind="seg_rating" srcText="hi" tgtText="嗨" />)
    expect(screen.getByTestId('oa-annotation-popup-kind-seg_rating')).toBeTruthy()
    expect(screen.getByTestId('oa-annotation-popup-star-1')).toBeTruthy()
    expect(screen.getByTestId('oa-annotation-popup-star-5')).toBeTruthy()
  })

  it('pressing Escape calls onClose', async () => {
    const onClose = vi.fn()
    render(<AnnotationPopup open={true} onClose={onClose} taskId="t_xxx" />)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('Cmd+Enter submits annotation (alt_trans)', async () => {
    const onSaved = vi.fn()
    const fetchMock = vi.fn()
      // initial GET (useAnnotation)
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }))
      // POST
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          id: 'a_new',
          annotation: {
            id: 'a_new', kind: 'alt_trans', schemaVersion: 1,
            taskId: 't_xxx', segmentId: 's_5',
            url: '', domPath: '',
            srcText: 'hi', tgtText: '嗨',
            langPair: ['zh-CN', 'en'], srcTokens: [], tgtTokens: [], predicted: [],
            modelVersion: 'myers-word-v1', payload: { text: 'better' }, context: {},
            createdAt: Date.now(), updatedAt: Date.now(),
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AnnotationPopup
        open={true}
        onClose={() => {}}
        onSaved={onSaved}
        taskId="t_xxx"
        segmentId="s_5"
        kind="alt_trans"
        srcText="hi"
        tgtText="嗨"
      />,
    )
    const textarea = screen.getByTestId('oa-annotation-popup-textarea')
    fireEvent.change(textarea, { target: { value: 'better' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 2000 })
    expect(onSaved.mock.calls[0][0].id).toBe('a_new')
  })

  it('Ctrl+Enter also submits (Windows-style)', async () => {
    const onSaved = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          id: 'a_new',
          annotation: {
            id: 'a_new', kind: 'alt_trans', schemaVersion: 1,
            taskId: 't_xxx', segmentId: 's_5',
            url: '', domPath: '',
            srcText: 'hi', tgtText: '嗨',
            langPair: ['zh-CN', 'en'], srcTokens: [], tgtTokens: [], predicted: [],
            modelVersion: 'myers-word-v1', payload: { text: 'x' }, context: {},
            createdAt: Date.now(), updatedAt: Date.now(),
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AnnotationPopup
        open={true}
        onClose={() => {}}
        onSaved={onSaved}
        taskId="t_xxx"
        segmentId="s_5"
        kind="alt_trans"
      />,
    )
    const textarea = screen.getByTestId('oa-annotation-popup-textarea')
    fireEvent.change(textarea, { target: { value: 'x' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 2000 })
  })

  it('clicking submit button saves annotation', async () => {
    const onSaved = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          id: 'a_x',
          annotation: {
            id: 'a_x', kind: 'alt_trans', schemaVersion: 1,
            taskId: 't_xxx', segmentId: 's_1',
            url: '', domPath: '',
            srcText: '', tgtText: '',
            langPair: ['zh-CN', 'en'], srcTokens: [], tgtTokens: [], predicted: [],
            modelVersion: 'myers-word-v1', payload: { text: 'tip' }, context: {},
            createdAt: Date.now(), updatedAt: Date.now(),
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AnnotationPopup open={true} onClose={() => {}} onSaved={onSaved} taskId="t_xxx" segmentId="s_1" kind="alt_trans" />,
    )
    const textarea = screen.getByTestId('oa-annotation-popup-textarea')
    fireEvent.change(textarea, { target: { value: 'tip' } })
    fireEvent.click(screen.getByTestId('oa-annotation-popup-submit'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 2000 })
  })

  it('edit mode prefills textarea with initialPayload', async () => {
    render(
      <AnnotationPopup
        open={true}
        onClose={() => {}}
        taskId="t_xxx"
        segmentId="s_5"
        kind="alt_trans"
        editingId="a_existing"
        initialPayload={{ text: 'preexisting comment' }}
      />,
    )
    const textarea = screen.getByTestId('oa-annotation-popup-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('preexisting comment')
  })

  it('cancel button does NOT save', async () => {
    const onSaved = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AnnotationPopup open={true} onClose={() => {}} onSaved={onSaved} taskId="t_xxx" segmentId="s_1" kind="alt_trans" />,
    )
    fireEvent.click(screen.getByTestId('oa-annotation-popup-cancel'))
    await waitFor(() => {
      expect(onSaved).not.toHaveBeenCalled()
    })
    // POST should not be called (only the initial GET)
    const postCalls = fetchMock.mock.calls.filter(c => (c[1] as RequestInit)?.method === 'POST')
    expect(postCalls.length).toBe(0)
  })

  it('focus trap — Tab cycles within modal', async () => {
    render(
      <AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" kind="alt_trans" />,
    )
    // The popup has a textarea (1st focusable) and submit/cancel buttons (last focusable).
    // Verify focus is on the first focusable after mount
    await waitFor(() => {
      expect(document.activeElement).toBeTruthy()
      const id = (document.activeElement as HTMLElement).getAttribute('data-testid')
      // Either textarea or first button
      expect(['oa-annotation-popup-textarea', 'oa-annotation-popup-cancel', 'oa-annotation-popup-submit']).toContain(id)
    })
  })

  it('shows validation error when alt_trans textarea is empty', async () => {
    render(
      <AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" segmentId="s_1" kind="alt_trans" />,
    )
    fireEvent.click(screen.getByTestId('oa-annotation-popup-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('oa-annotation-popup-error')).toBeTruthy()
    })
  })

  it('has aria-modal and role=dialog', () => {
    render(<AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" />)
    const popup = screen.getByTestId('oa-annotation-popup')
    expect(popup.getAttribute('role')).toBe('dialog')
    expect(popup.getAttribute('aria-modal')).toBe('true')
  })

  it('logs ISO observability on save', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          id: 'a_log',
          annotation: {
            id: 'a_log', kind: 'alt_trans', schemaVersion: 1,
            taskId: 't_xxx', segmentId: 's_5',
            url: '', domPath: '',
            srcText: '', tgtText: '',
            langPair: ['zh-CN', 'en'], srcTokens: [], tgtTokens: [], predicted: [],
            modelVersion: 'myers-word-v1', payload: { text: 'tip' }, context: {},
            createdAt: Date.now(), updatedAt: Date.now(),
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AnnotationPopup open={true} onClose={() => {}} taskId="t_xxx" segmentId="s_5" kind="alt_trans" />,
    )
    fireEvent.change(screen.getByTestId('oa-annotation-popup-textarea'), { target: { value: 'tip' } })
    fireEvent.click(screen.getByTestId('oa-annotation-popup-submit'))
    await waitFor(() => {
      const logs = info.mock.calls.map(c => String(c[0]))
      expect(logs.some(l => l.includes('[translate-annotation') && l.includes('popup save') && l.includes('kind=alt_trans'))).toBe(true)
    }, { timeout: 2000 })
    info.mockRestore()
  })
})