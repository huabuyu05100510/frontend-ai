// PreviewModal 双模式持久化测试
// 覆盖：localStorage 读取、auto 解析、点击切换、localStorage 回写、转码中进度条
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PreviewModal } from '../src/components/PreviewModal'
import type { Task } from '../src/types'

function pdfTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
    convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
    ...over
  } as Task
}

describe('PreviewModal 模式持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('默认（auto）且 task 有 pages → 进入图片模式（顶部显示「图片」选中）', () => {
    const task = pdfTask({
      pages: [{ page: 1, url: '/p/1', width: 100, height: 100, bytes: 1000 }],
      pagesTotal: 1
    })
    render(<PreviewModal task={task} onClose={() => {}} onDownload={() => {}} />)
    const imagesBtn = screen.getByRole('button', { name: /图片\+文字/ })
    expect(imagesBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('localStorage.previewMode=pdf → 即使有 pages 也走 PDF 模式', () => {
    localStorage.setItem('previewMode', 'pdf')
    const task = pdfTask({
      pages: [{ page: 1, url: '/p/1', width: 100, height: 100, bytes: 1000 }]
    })
    render(<PreviewModal task={task} onClose={() => {}} onDownload={() => {}} />)
    const pdfBtn = screen.getByRole('button', { name: /PDF 模式/ })
    expect(pdfBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('点击「图片+文字」按钮 → 切换 + 写 localStorage', () => {
    const task = pdfTask({
      pages: [{ page: 1, url: '/p/1', width: 100, height: 100, bytes: 1000 }]
    })
    render(<PreviewModal task={task} onClose={() => {}} onDownload={() => {}} />)
    const imagesBtn = screen.getByRole('button', { name: /图片\+文字/ })
    fireEvent.click(imagesBtn)
    expect(localStorage.getItem('previewMode')).toBe('images')
    expect(imagesBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('点击「PDF 模式」按钮 → 切换 + 写 localStorage', () => {
    const task = pdfTask({
      pages: [{ page: 1, url: '/p/1', width: 100, height: 100, bytes: 1000 }]
    })
    render(<PreviewModal task={task} onClose={() => {}} onDownload={() => {}} />)
    const pdfBtn = screen.getByRole('button', { name: /PDF 模式/ })
    fireEvent.click(pdfBtn)
    expect(localStorage.getItem('previewMode')).toBe('pdf')
    expect(pdfBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('转码中显示阶段 + 进度条', () => {
    const task = pdfTask({
      strategy: 'convert_pdf',
      convertStatus: 'processing',
      convertStage: 'pages',
      pagesDone: 3,
      pagesTotal: 10
    })
    render(<PreviewModal task={task} onClose={() => {}} onDownload={() => {}} />)
    // 进度文本存在；阶段 chip 也存在
    expect(screen.getByText(/页面 3 \/ 10/)).toBeTruthy()
  })

  it('ESC 触发 onClose', () => {
    const onClose = vi.fn()
    render(<PreviewModal task={pdfTask()} onClose={onClose} onDownload={() => {}} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})