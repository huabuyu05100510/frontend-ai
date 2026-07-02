// OCRPage: 导出可搜索 PDF 新文件 端到端测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OCRPage } from '../src/pages/OCRPage'
import { useStore } from '../src/store'

beforeEach(() => {
  vi.restoreAllMocks()
  useStore.setState({
    tasks: [{
      id: 't_img1', name: 'invoice.png', ext: 'png', status: 'ready',
      originalUrl: '/api/files/t_img1?as=original',
    } as any],
    fetchTasks: vi.fn().mockResolvedValue(undefined),
  })
  vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
    const u = url.startsWith('http') ? url : 'http://test' + url
    const p = new URL(u).pathname
    const method = (init?.method || 'GET').toUpperCase()
    if (p === '/api/tasks' && method === 'GET') {
      return new Response(JSON.stringify({
        tasks: [{ id: 't_img1', name: 'invoice.png', ext: 'png', status: 'ready', originalUrl: '/api/files/t_img1?as=original' }],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/ocr/recognize' && method === 'POST') {
      return new Response(JSON.stringify({
        engine: 'mock', ms: 10,
        text: 'Hello world',
        regions: [
          { text: 'Hello', x: 100, y: 100, width: 100, height: 30, confidence: 0.95 },
          { text: 'world', x: 220, y: 100, width: 80, height: 30, confidence: 0.42 },
        ],
        imageSize: { width: 800, height: 600 },
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/ocr/create-task' && method === 'POST') {
      return new Response(JSON.stringify({
        taskId: 't_new_pdf_123',
        originalUrl: '/api/files/t_new_pdf_123?as=original',
        size: 1234,
        engine: 'mock',
        textRegions: 2,
        ms: 5,
        sourceTaskId: 't_img1',
        name: 'invoice-searchable.pdf',
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
})

async function startRecognition() {
  // 用 findAllByText 过滤 + 等 useEffect 注入 taskId 让按钮启用
  const btns = await screen.findAllByText('开始识别', {}, { timeout: 3000 })
  const recognize = btns.find(b => b.className.includes('xf-btn-solid')) as HTMLButtonElement
  await waitFor(() => expect(recognize).not.toBeDisabled(), { timeout: 3000 })
  fireEvent.click(recognize)
  await waitFor(() => expect(screen.queryByTestId('ocr-export-pdf')).toBeTruthy())
}

describe('OCRPage: 导出可搜索 PDF 新文件', () => {
  it('识别后展示"导出可搜索 PDF"按钮', async () => {
    render(<OCRPage />)
    await startRecognition()
    const exp = screen.getByTestId('ocr-export-pdf')
    expect(exp).toBeTruthy()
    expect(exp.textContent).toContain('导出可搜索 PDF')
  })

  it('点击 → POST /api/ocr/create-task → 显示 toast + 调 fetchTasks', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ fetchTasks: fetchSpy })
    render(<OCRPage />)
    await startRecognition()
    fireEvent.click(screen.getByTestId('ocr-export-pdf'))
    await waitFor(() => {
      expect(screen.getByTestId('ocr-export-toast')).toBeTruthy()
    })
    expect(screen.getByTestId('ocr-export-toast').textContent).toContain('invoice-searchable.pdf')
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('未识别时按钮 disabled', async () => {
    render(<OCRPage />)
    // 等按钮渲染 + 注入
    await screen.findAllByText('开始识别', {}, { timeout: 3000 })
    const exp = screen.getByTestId('ocr-export-pdf') as HTMLButtonElement
    expect(exp.disabled).toBe(true)
  })
})
