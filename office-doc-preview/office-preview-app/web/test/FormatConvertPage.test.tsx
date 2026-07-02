// FormatConvertPage 测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FormatConvertPage } from '../src/pages/FormatConvertPage'
import { useStore } from '../src/store'
import type { Task } from '../src/types'

function docxTask(over: Partial<Task> = {}): Task {
  return {
    id: over.id || 't1',
    name: over.name || 'demo.docx',
    size: over.size || 12345,
    ext: over.ext || 'docx',
    mime: 'application/vnd.openxmlformats',
    strategy: over.strategy || 'convert_pdf',
    originalUrl: '/api/files/t1?as=original',
    previewUrl: over.previewUrl ?? '/api/files/t1?as=preview',
    previewExt: over.previewExt ?? 'pdf',
    convertStatus: over.convertStatus || 'done',
    status: over.status || 'ready',
    pages: over.pages,
    pagesTotal: over.pagesTotal,
    pagesDone: over.pagesDone,
    previewSize: over.previewSize,
    convertDurationMs: over.convertDurationMs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Task
}

function pageImage(n: number) {
  return {
    page: n,
    url: `/api/files/t1?as=page&n=${n}`,
    textUrl: `/api/files/t1?as=text&n=${n}`,
    width: 800, height: 1130, bytes: 1000,
  }
}

beforeEach(() => {
  useStore.setState({ tasks: [] })
  vi.restoreAllMocks()
})

describe('FormatConvertPage 结构', () => {
  it('无任务时显示空状态', () => {
    render(<FormatConvertPage />)
    expect(screen.getByTestId('format-convert-page')).toBeTruthy()
    expect(screen.getByText(/暂无可转换的文档/)).toBeTruthy()
  })

  it('三个子菜单 tab 存在', () => {
    useStore.setState({ tasks: [docxTask()] })
    render(<FormatConvertPage />)
    expect(screen.getByTestId('fc-tab-convert').textContent).toBe('格式转换')
    expect(screen.getByTestId('fc-tab-compare').textContent).toBe('对比预览')
    expect(screen.getByTestId('fc-tab-annotate').textContent).toBe('文字标注')
  })

  it('切换到对比预览模式', () => {
    useStore.setState({ tasks: [docxTask()] })
    render(<FormatConvertPage />)
    fireEvent.click(screen.getByTestId('fc-tab-compare'))
    expect(screen.getByTestId('fc-compare-mode')).toBeTruthy()
  })

  it('切换到文字标注模式', () => {
    useStore.setState({ tasks: [docxTask({ pages: [pageImage(1)] })] })
    render(<FormatConvertPage />)
    fireEvent.click(screen.getByTestId('fc-tab-annotate'))
    expect(screen.getByTestId('fc-annotate-mode')).toBeTruthy()
  })
})

describe('ConvertMode 转换流程', () => {
  it('选择文件后调用 /api/convert 并展示产物', async () => {
    useStore.setState({ tasks: [docxTask({ id: 't_doc1', name: 'spec.docx' })] })
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        taskId: 't_doc1',
        status: 'done',
        target: 'pdf',
        pdfUrl: '/api/files/t_doc1?as=preview',
        pages: [{ page: 1, url: '/api/files/t_doc1?as=page&n=1', textUrl: '/api/files/t_doc1?as=text&n=1', width: 800, height: 1130 }],
        originalUrl: '/api/files/t_doc1?as=original',
        meta: { pagesCount: 1, pdfSize: 8888, convertMs: 1500, engine: 'soffice+pdfium', ext: 'docx', strategy: 'convert_pdf' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    render(<FormatConvertPage />)
    const sel = screen.getByTestId('fc-source-select') as HTMLSelectElement
    fireEvent.change(sel, { target: { value: 't_doc1' } })
    fireEvent.click(screen.getByTestId('fc-convert-btn'))

    await waitFor(() => {
      expect(screen.getByText(/PDF 文档/)).toBeTruthy()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/convert', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('转换失败显示错误', async () => {
    useStore.setState({ tasks: [docxTask({ id: 't_fail', name: 'bad.docx' })] })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'soffice timeout' }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
    )

    render(<FormatConvertPage />)
    fireEvent.change(screen.getByTestId('fc-source-select'), { target: { value: 't_fail' } })
    fireEvent.click(screen.getByTestId('fc-convert-btn'))

    await waitFor(() => {
      expect(screen.getByText(/soffice timeout/)).toBeTruthy()
    })
  })
})

describe('AnnotateMode 标注流程', () => {
  it('加载标注列表', async () => {
    useStore.setState({ tasks: [docxTask({ id: 't_anno', pages: [pageImage(1)] })] })
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      if (url.startsWith('/api/annotate/')) {
        return new Response(JSON.stringify({
          taskId: 't_anno',
          annotations: [{
            id: 'a_1', taskId: 't_anno', page: 1,
            text: '重点', note: '需复核', color: '#fff3bf',
            createdAt: Date.now(),
          }],
        }) as any, { status: 200 })
      }
      // text layer fetch
      if (url.includes('as=text')) {
        return new Response('<div><span>hello</span></div>', { status: 200, headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('ok', { status: 200 })
    }) as any)

    render(<FormatConvertPage />)
    fireEvent.click(screen.getByTestId('fc-tab-annotate'))
    fireEvent.change(screen.getByTestId('fc-anno-source'), { target: { value: 't_anno' } })

    await waitFor(() => {
      expect(screen.getByText(/本页标注/)).toBeTruthy()
    })
    // 标注卡片渲染
    expect(screen.getAllByText(/需复核/).length).toBeGreaterThan(0)
  })
})
