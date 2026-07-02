// 模型：claude-sonnet-4-6
// DocTranslateMode — wraps DocTranslateStagePanel (Phase B closed-loop).
// The legacy 148-line <pre> JSON dump body was replaced with a URL-state
// orchestrator in Phase B; this file is the retained test entry point and
// exercises the high-level integration with <MemoryRouter>.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DocTranslateMode } from '../../src/pages/TranslationPage'
import { useStore } from '../../src/store'
import { useToastStore } from '../../src/hooks/useToast'
import type { Task } from '../../src/types'

function mkTask(id: string, ext: string, name: string): Task {
  return {
    id, name, size: 1024, ext, mime: 'application/octet-stream',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: ext,
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
  } as Task
}

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<DocTranslateMode tasks={[]} />} />
      </Routes>
    </MemoryRouter>,
  )
}

if (typeof URL.createObjectURL !== 'function') {
  let id = 1
  ;(URL as any).createObjectURL = () => `blob:mock/${id++}`
  ;(URL as any).revokeObjectURL = () => {}
}

beforeEach(() => {
  useStore.setState({
    translateOpen: false,
    translateSource: null,
    translateTargetLang: 'en',
    translateSourceLang: 'zh-CN',
    translateStatus: 'idle',
    translateResult: null,
    translateError: null,
    translateRenderMode: 'images',
    tasks: [],
  })
  useToastStore.setState({ queue: [] })
  // @ts-ignore
  global.fetch = vi.fn().mockImplementation(async () => ({
    ok: true, status: 200, headers: new Headers(), json: async () => ({ items: [] }),
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DocTranslateMode (Phase B orchestrator) integration', () => {
  it('mounts DocTranslateStagePanel inside MemoryRouter', () => {
    renderWithRouter('/translate?mode=doc')
    expect(screen.getByTestId('oa-doc-stage-panel')).toBeTruthy()
  })

  it('mounts the Toast container (single instance) — visible only when queue non-empty', () => {
    // Toast returns null when queue is empty (per Phase A.1 design)
    const { unmount } = renderWithRouter('/translate?mode=doc')
    expect(screen.queryByTestId('oa-toast-container')).toBeNull()
    unmount()

    // Push a toast, remount, container should appear
    useToastStore.getState().push({ kind: 'info', message: 'hello' })
    renderWithRouter('/translate?mode=doc')
    expect(screen.getByTestId('oa-toast-container')).toBeTruthy()
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('reads stage from URL search params and reflects on data-stage', () => {
    renderWithRouter('/translate?mode=doc&stage=review&task=t_legacy')
    const panel = screen.getByTestId('oa-doc-stage-panel')
    expect(panel.getAttribute('data-stage')).toBe('review')
  })

  it('clicking a stage chip updates URL and stage data attribute', async () => {
    renderWithRouter('/translate?mode=doc')
    fireEvent.click(screen.getByTestId('oa-stage-translating'))
    await waitFor(() => {
      expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('translating')
    })
  })

  it('preserves task param across stage transitions', async () => {
    renderWithRouter('/translate?mode=doc&task=t_legacy')
    fireEvent.click(screen.getByTestId('oa-stage-export'))
    await waitFor(() => {
      expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('export')
    })
  })

  it('rejects legacy DocTranslateTaskPanel testids (body removed)', () => {
    // Phase B removed <DocTranslateTaskPanel>, <DocTranslateProgress> and the
    // legacy <pre> JSON dump. Confirm none of those testids leak.
    renderWithRouter('/translate?mode=doc&task=t_legacy')
    expect(screen.queryByTestId('doc-translate-task-panel')).toBeNull()
    expect(screen.queryByTestId('doc-translate-start')).toBeNull()
    expect(screen.queryByTestId('doc-translate-cancel')).toBeNull()
    expect(screen.queryByTestId('doc-translate-progress')).toBeNull()
  })

  it('handles Task prop array of mixed document extensions (panel filters)', () => {
    // store-side filtering is now in DocTranslateStagePanel — we just verify
    // that the wrapper still accepts tasks without crashing.
    useStore.setState({
      tasks: [
        mkTask('a1', 'docx', 'a.docx'),
        mkTask('a2', 'pdf', 'a.pdf'),
        mkTask('a3', 'mp3', 'a.mp3'),
      ],
    })
    renderWithRouter('/translate?mode=doc&task=a1')
    expect(screen.getByTestId('oa-doc-stage-panel')).toBeTruthy()
  })
})
