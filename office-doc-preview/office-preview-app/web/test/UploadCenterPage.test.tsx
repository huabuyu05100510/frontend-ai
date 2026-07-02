// UploadCenterPage 测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadCenterPage } from '../src/pages/UploadCenterPage'
import { useStore } from '../src/store'

beforeEach(() => {
  useStore.setState({ tasks: [], fetchTasks: vi.fn().mockResolvedValue(undefined) })
  vi.restoreAllMocks()
})

describe('UploadCenterPage 结构', () => {
  it('渲染 6 个预设场景 tab', () => {
    render(<UploadCenterPage />)
    expect(screen.getByTestId('uc-scenario-universal')).toBeTruthy()
    expect(screen.getByTestId('uc-scenario-document')).toBeTruthy()
    expect(screen.getByTestId('uc-scenario-image')).toBeTruthy()
    expect(screen.getByTestId('uc-scenario-audio')).toBeTruthy()
    expect(screen.getByTestId('uc-scenario-video')).toBeTruthy()
    expect(screen.getByTestId('uc-scenario-ai-image')).toBeTruthy()
  })

  it('切换场景更新说明卡', () => {
    render(<UploadCenterPage />)
    // 默认 universal（desc 出现在说明卡）
    expect(screen.getAllByText(/全格式/).length).toBeGreaterThan(0)
    // 切换到 image
    fireEvent.click(screen.getByTestId('uc-scenario-image'))
    expect(screen.getAllByText(/图片上传/).length).toBeGreaterThan(0)
  })

  it('默认显示上传区', () => {
    render(<UploadCenterPage />)
    // UploadZone 的提示文案
    const dropHint = screen.getByText(/拖拽文件到此处或点击选择/)
    expect(dropHint).toBeTruthy()
  })
})

describe('UploadCenterPage 历史', () => {
  it('加载并显示上传历史', async () => {
    const mockHistory = {
      items: [
        {
          id: 'h1', name: 'report.pdf', ext: 'pdf', size: 1024,
          status: 'ready', convertStatus: 'done',
          createdAt: Date.now() - 86400000,
          previewUrl: '/api/files/h1?as=preview',
          originalUrl: '/api/files/h1?as=original',
        },
        {
          id: 'h2', name: 'photo.jpg', ext: 'jpg', size: 2048,
          status: 'ready', convertStatus: 'done',
          createdAt: Date.now(),
          previewUrl: null,
          originalUrl: '/api/files/h2?as=original',
        },
      ],
    }
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      if (url.startsWith('/api/upload/history')) {
        return new Response(JSON.stringify(mockHistory) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('ok', { status: 200 })
    }) as any)

    render(<UploadCenterPage />)
    await waitFor(() => {
      const items = screen.getAllByTestId('uc-history-item')
      expect(items.length).toBe(2)
    })
    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(screen.getByText('photo.jpg')).toBeTruthy()
  })

  it('切换到 image 场景时按 accept 过滤历史', async () => {
    const mockHistory = {
      items: [
        { id: 'h1', name: 'doc.pdf', ext: 'pdf', size: 1, status: 'ready', convertStatus: 'done', createdAt: Date.now(), previewUrl: null, originalUrl: '/o1' },
        { id: 'h2', name: 'pic.jpg', ext: 'jpg', size: 1, status: 'ready', convertStatus: 'done', createdAt: Date.now(), previewUrl: null, originalUrl: '/o2' },
      ],
    }
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      if (url.startsWith('/api/upload/history')) {
        return new Response(JSON.stringify(mockHistory) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('ok', { status: 200 })
    }) as any)

    render(<UploadCenterPage />)
    await waitFor(() => expect(screen.getAllByTestId('uc-history-item').length).toBe(2))

    // 切换到 image（accept: jpg/jpeg/png/bmp）
    fireEvent.click(screen.getByTestId('uc-scenario-image'))
    await waitFor(() => {
      const items = screen.getAllByTestId('uc-history-item')
      expect(items.length).toBe(1)
      expect(screen.getByText('pic.jpg')).toBeTruthy()
    })
  })

  it('历史为空时显示空状态', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      if (url.startsWith('/api/upload/history')) {
        return new Response(JSON.stringify({ items: [] }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('ok', { status: 200 })
    }) as any)

    render(<UploadCenterPage />)
    await waitFor(() => {
      expect(screen.getByText(/暂无上传历史/)).toBeTruthy()
    })
  })
})
