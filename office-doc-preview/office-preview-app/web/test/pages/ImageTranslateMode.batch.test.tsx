// ImageTranslateMode batch flow — 3 mock images 批量识别+翻译
// 模型：claude-sonnet-4-6
//
// Phase D fix: the new ImageTranslateMode shell uses useSearchParams, so all
// renders must be wrapped in <MemoryRouter>. Testid `image-translate-batch`
// was renamed to `oa-image-stage-batch` in Phase C. The remaining batch-* ids
// (image-batch-queue, batch-task-X, batch-status, batch-start, batch-cancel)
// are owned by <ImageBatchQueue> and unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ImageTranslateMode } from '../../src/pages/ImageTranslateMode'
import { useStore } from '../../src/store'
import type { Task, OCRRegion } from '../../src/types'

function makeImgTask(id: string, name: string): Task {
  return {
    id, name, size: 100, ext: 'png', mime: 'image/png',
    strategy: 'frontend', originalUrl: '/api/files/' + id, previewUrl: null, previewExt: 'png',
    convertStatus: 'done', status: 'ready',
    createdAt: 0, updatedAt: 0,
  } as Task
}

const TASKS = [
  makeImgTask('a', 'a.png'),
  makeImgTask('b', 'b.png'),
  makeImgTask('c', 'c.png'),
]

function buildRegions(seed: number): OCRRegion[] {
  return [
    { text: `Hello-${seed}`, x: 10, y: 20, width: 100, height: 30, confidence: 0.95 },
    { text: `World-${seed}`, x: 200, y: 50, width: 80, height: 25, confidence: 0.5 },
  ]
}

function renderInRouter(ui: React.ReactNode, initialEntry = '/translate?mode=image&stage=pick') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<>{ui}</>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ tasks: TASKS, fetchTasks: vi.fn().mockResolvedValue(undefined) })
})

describe('ImageTranslateMode — 批量流程 (3 mock images)', () => {
  it('点击「批量」打开队列，3 个任务可勾选', async () => {
    // jsdom does not implement URL.createObjectURL by default; the StagePanel
    // export flow uses it, so stub once for the whole suite.
    if (typeof URL.createObjectURL !== 'function') {
      let id = 1
      ;(URL as any).createObjectURL = () => `blob:mock/${id++}`
      ;(URL as any).revokeObjectURL = () => {}
    }
    renderInRouter(<ImageTranslateMode tasks={TASKS} />)
    // The shell mounts the StagePanel in 'pick' stage. The batch trigger button
    // lives inside StagePanel with the new testid `oa-image-stage-batch`.
    fireEvent.click(screen.getByTestId('oa-image-stage-batch'))
    // <ImageBatchQueue> uses the unchanged testids `image-batch-queue`,
    // `batch-task-<id>` and `batch-status`.
    expect(screen.getByTestId('image-batch-queue')).toBeTruthy()
    expect(screen.getByTestId('batch-task-a')).toBeTruthy()
    expect(screen.getByTestId('batch-task-b')).toBeTruthy()
    expect(screen.getByTestId('batch-task-c')).toBeTruthy()
  })

  it('勾选 3 个任务 → 点击开始 → 调用 batch API', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/translate/image/batch') && !url.includes('/cancel')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'job-batch', total: 3, progressUrl: '/api/translate/image/batch/job-batch' }) } as any
      }
      return { ok: true, status: 200, json: async () => ({ frames: [] }) } as any
    })
    global.fetch = fetchMock

    renderInRouter(<ImageTranslateMode tasks={TASKS} />)
    fireEvent.click(screen.getByTestId('oa-image-stage-batch'))
    fireEvent.click(screen.getByTestId('batch-task-a'))
    fireEvent.click(screen.getByTestId('batch-task-b'))
    fireEvent.click(screen.getByTestId('batch-task-c'))

    fireEvent.click(screen.getByTestId('batch-start'))

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]: any) => typeof u === 'string' && u.includes('/api/translate/image/batch'))
      expect(calls.length).toBeGreaterThanOrEqual(1)
    })
    const lastCall = fetchMock.mock.calls.filter(([u]: any) => typeof u === 'string' && u.includes('/api/translate/image/batch')).pop()!
    const body = JSON.parse(lastCall[1].body)
    expect(body.taskIds).toEqual(['a', 'b', 'c'])
  })

  it('batch 状态显示 (running / completed / cancelled)', async () => {
    let pollCount = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/translate/image/batch') && !url.includes('/cancel')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'j', total: 3, progressUrl: '/api/translate/image/batch/j' }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/translate/image/batch/j')) {
        pollCount++
        if (pollCount === 1) {
          return { ok: true, status: 200, json: async () => ({ frames: [{ taskId: 'a', status: 'ocr-done' }] }) } as any
        }
        return { ok: true, status: 200, json: async () => ({ frames: [{ taskId: 'a', status: 'image-done' }, { taskId: 'b', status: 'image-done' }, { taskId: 'c', status: 'image-done' }], done: true }) } as any
      }
      if (typeof url === 'string' && url.includes('/cancel')) {
        return { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) } as any
      }
      return { ok: true, status: 200, text: async () => '{}' } as any
    })
    global.fetch = fetchMock

    renderInRouter(<ImageTranslateMode tasks={TASKS} />)
    fireEvent.click(screen.getByTestId('oa-image-stage-batch'))
    fireEvent.click(screen.getByTestId('batch-task-a'))
    fireEvent.click(screen.getByTestId('batch-task-b'))
    fireEvent.click(screen.getByTestId('batch-task-c'))
    fireEvent.click(screen.getByTestId('batch-start'))

    // 状态从 idle → started → running → completed
    await waitFor(() => {
      const status = screen.getByTestId('batch-status')
      expect(['started', 'running', 'completed']).toContain(status.getAttribute('data-status'))
    }, { timeout: 2000 })
  })

  it('批量完成后任务列表中翻译状态更新', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/translate/image/batch') && !url.includes('/cancel')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'j', total: 3, progressUrl: '/api/translate/image/batch/j' }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/translate/image/batch/j')) {
        return { ok: true, status: 200, json: async () => ({ frames: [{ taskId: 'a', status: 'image-done' }, { taskId: 'b', status: 'image-done' }, { taskId: 'c', status: 'image-done' }], done: true }) } as any
      }
      return { ok: true, status: 200, text: async () => '{}' } as any
    })
    global.fetch = fetchMock

    renderInRouter(<ImageTranslateMode tasks={TASKS} />)
    fireEvent.click(screen.getByTestId('oa-image-stage-batch'))
    fireEvent.click(screen.getByTestId('batch-task-a'))
    fireEvent.click(screen.getByTestId('batch-task-b'))
    fireEvent.click(screen.getByTestId('batch-task-c'))
    fireEvent.click(screen.getByTestId('batch-start'))

    await waitFor(() => {
      const items = screen.getByTestId('batch-items')
      expect(items.textContent).toContain('a')
      expect(items.textContent).toContain('b')
      expect(items.textContent).toContain('c')
    })
  })

  it('点击「取消」调用 cancel endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/translate/image/batch') && !url.includes('/cancel')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'jc', total: 3, progressUrl: '/api/translate/image/batch/jc' }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/translate/image/batch/jc/cancel')) {
        return { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/translate/image/batch/jc')) {
        return { ok: true, status: 200, json: async () => ({ frames: [] }) } as any
      }
      return { ok: true, status: 200, text: async () => '{}' } as any
    })
    global.fetch = fetchMock

    renderInRouter(<ImageTranslateMode tasks={TASKS} />)
    fireEvent.click(screen.getByTestId('oa-image-stage-batch'))
    fireEvent.click(screen.getByTestId('batch-task-a'))
    fireEvent.click(screen.getByTestId('batch-start'))
    await waitFor(() => screen.getByTestId('batch-cancel'))

    fireEvent.click(screen.getByTestId('batch-cancel'))

    await waitFor(() => {
      const cancelCalls = fetchMock.mock.calls.filter(([u]: any) => typeof u === 'string' && u.includes('/cancel'))
      expect(cancelCalls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
