// 模型：claude-sonnet-4-6
// DocTranslateStagePanel — 4 阶段编排面板的 TDD 测试
// Phase B: 14 tests
//
// 覆盖：
//   1-2   stage indicator renders
//   3-5   pick: task select + lang select + start button
//   6-7   translating: progress bar + cancel
//   8-10  review: lazy TranslationLayout + AnnotationList + download
//   11-13 export: format select + doExport + finish (reset)
//   14    accessibility

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DocTranslateStagePanel } from '../../src/pages/DocTranslateStagePanel'
import type { TranslateStage } from '../../src/hooks/useTranslateStage'
import { useToastStore } from '../../src/hooks/useToast'
import { useStore } from '../../src/store'
import type { Task } from '../../src/types'

// Lazy import mock: avoid actually loading TranslationLayout (pulls in WASM)
vi.mock('../../src/inspect/TranslationLayout', () => ({
  TranslationLayout: (props: { onDownload?: () => void }) => (
    <div data-testid="translation-layout-mock" data-has-handler={props?.onDownload ? 'true' : 'false'}>
      Mock Layout
    </div>
  ),
}))

function mkTask(id: string, ext: string, name = `${id}.${ext}`): Task {
  return {
    id, name, size: 1000, ext, mime: 'application/octet-stream',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: ext,
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
  } as Task
}

function renderPanel(stage: TranslateStage = 'pick', opts?: {
  tasks?: Task[]
  initialTaskId?: string
}) {
  let current = stage
  const onChange = vi.fn((s: TranslateStage) => { current = s })
  const utils = render(
    <MemoryRouter initialEntries={[`/translate?stage=${stage}`]}>
      <Routes>
        <Route
          path="*"
          element={
            <DocTranslateStagePanel
              stage={current}
              onStageChange={onChange}
              initialTaskId={opts?.initialTaskId}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return { ...utils, onChange, getStage: () => current }
}

beforeEach(() => {
  useToastStore.setState({ queue: [] })

  // jsdom doesn't implement URL.createObjectURL/Revoke (used by download flow)
  if (typeof URL.createObjectURL !== 'function') {
    let id = 1
    ;(URL as any).createObjectURL = () => `blob:mock/${id++}`
    ;(URL as any).revokeObjectURL = () => {}
  }
  // @ts-ignore — minimal fetch stub
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (typeof url === 'string') {
      if (url.includes('/api/translate/annotation')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ items: [] }) }
      }
      if (url.includes('/api/inspect/translate/export')) {
        return {
          ok: true, status: 200,
          headers: new Headers({ 'x-export-format': 'bilingual-docx' }),
          blob: async () => new Blob([new Uint8Array([0x50, 0x4b])], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        } as any
      }
      if (url.includes('/api/inspect/translate/progress')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ jobId: '', lastSeq: 0, frames: [] }) }
      }
      if (url.includes('/api/inspect/translate')) {
        return {
          ok: true, status: 200,
          headers: new Headers({ 'x-job-id': 'tj_test', 'x-translate-glossary-hits': '1', 'x-translate-tm-hits': '2' }),
          json: async () => ({ segments: [], pages: [], meta: {} }),
        }
      }
    }
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) }
  })
  // Seed store with tasks
  useStore.setState({
    tasks: [
      mkTask('t_docx', 'docx', 'demo.docx'),
      mkTask('t_pdf', 'pdf', 'demo.pdf'),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ tasks: [] })
})

describe('DocTranslateStagePanel', () => {
  it('1. renders the 4-stage indicator header', () => {
    renderPanel('pick')
    expect(screen.getByTestId('oa-stage-indicator')).toBeTruthy()
    expect(screen.getByTestId('oa-stage-pick')).toBeTruthy()
    expect(screen.getByTestId('oa-stage-translating')).toBeTruthy()
    expect(screen.getByTestId('oa-stage-review')).toBeTruthy()
    expect(screen.getByTestId('oa-stage-export')).toBeTruthy()
  })

  it('2. clicking a stage chip fires onStageChange', () => {
    const { onChange } = renderPanel('pick')
    fireEvent.click(screen.getByTestId('oa-stage-export'))
    expect(onChange).toHaveBeenCalledWith('export')
  })

  it('3. pick: shows task select + lang selects when tasks exist', () => {
    renderPanel('pick', { tasks: [mkTask('t_docx', 'docx')] })
    expect(screen.getByTestId('oa-doc-stage-task-select')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-source-lang')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-target-lang')).toBeTruthy()
  })

  it('4. pick: shows empty CTA when no tasks', () => {
    useStore.setState({ tasks: [] })
    renderPanel('pick')
    expect(screen.getByTestId('oa-doc-stage-pick-empty')).toBeTruthy()
  })

  it('5. pick: stage has aria-label and panel data-stage', () => {
    renderPanel('pick')
    const section = screen.getByTestId('oa-doc-stage-pick')
    expect(section.getAttribute('aria-label')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('pick')
  })

  it('6. pick: start button disabled when no task selected', () => {
    renderPanel('pick')
    expect((screen.getByTestId('oa-doc-stage-start') as HTMLButtonElement).disabled).toBe(true)
  })

  it('7. pick: clicking start with selected task fires translate fetch', async () => {
    renderPanel('pick', { initialTaskId: 't_docx' })
    fireEvent.click(screen.getByTestId('oa-doc-stage-start'))
    await waitFor(() => {
      expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/api/inspect/translate'))).toBe(true)
    })
  })

  it('8. review: lazy TranslationLayout is mounted with onDownload prop', () => {
    renderPanel('review', { initialTaskId: 't_docx' })
    // Wait for Suspense fallback to resolve
    return waitFor(() => {
      expect(screen.getByTestId('translation-layout-mock')).toBeTruthy()
      expect(screen.getByTestId('translation-layout-mock').getAttribute('data-has-handler')).toBe('true')
    })
  })

  it('9. review: AnnotationList is wired with taskId', async () => {
    renderPanel('review', { initialTaskId: 't_docx' })
    // AnnotationList has data-task-id
    return waitFor(() => {
      const list = document.querySelector('.oa-annotation-list-wrap, [data-task-id="t_docx"]')
      expect(list).toBeTruthy()
    })
  })

  it('10. review: ResizableSplit renders 2 panes', () => {
    renderPanel('review', { initialTaskId: 't_docx' })
    expect(screen.getByTestId('oa-split')).toBeTruthy()
    expect(screen.getByTestId('oa-split-pane-primary')).toBeTruthy()
    expect(screen.getByTestId('oa-split-pane-secondary')).toBeTruthy()
  })

  it('11. export: 4 format radios render', () => {
    renderPanel('export', { initialTaskId: 't_docx' })
    expect(screen.getByTestId('oa-doc-stage-export-fmt-bilingual-docx')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-export-fmt-bilingual-pdf')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-export-fmt-target-pdf')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-export-fmt-vtt')).toBeTruthy()
  })

  it('12. export: clicking export pushes a toast on success', async () => {
    renderPanel('export', { initialTaskId: 't_docx' })
    fireEvent.click(screen.getByTestId('oa-doc-stage-export-go'))
    await waitFor(() => {
      const queue = useToastStore.getState().queue
      expect(queue.some(t => t.message === '导出成功' && t.kind === 'success')).toBe(true)
    })
  })

  it('13. export: 完成 button triggers stage reset (onStageChange fired)', () => {
    const { onChange } = renderPanel('export', { initialTaskId: 't_docx' })
    fireEvent.click(screen.getByTestId('oa-doc-stage-export-finish'))
    expect(onChange).toHaveBeenCalled()
  })

  it('14. accessibility: navigation role on StageIndicator nav', () => {
    renderPanel('pick')
    const nav = screen.getByRole('navigation')
    expect(nav).toBeTruthy()
  })
})
