// OCRPage 图片区域 ↔ 文字卡 hover 联动测试
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
  // 默认 mock：OCR 返回 2 个 region（testid 用命中文字）
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
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
})

async function findRecognizeBtn(): Promise<HTMLButtonElement> {
  // 等待 useEffect 注入 images[activeIdx].taskId → 按钮启用
  // 用 getAllByText + className 过滤，避免"图片识别"误匹配
  const btns = await screen.findAllByText('开始识别', {}, { timeout: 3000 })
  const recognize = btns.find(b => b.className.includes('xf-btn-solid')) as HTMLButtonElement
  expect(recognize).toBeTruthy()
  await waitFor(() => expect(recognize).not.toBeDisabled(), { timeout: 3000 })
  return recognize
}

describe('OCRPage 图片区域 ↔ 文字卡 hover 联动', () => {
  it('识别后 SVG 区域可交互 + hover 区域 → 文字卡高亮', async () => {
    render(<OCRPage />)
    const btn = await findRecognizeBtn()
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByTestId('ocr-region-svg')).toBeTruthy())
    expect(screen.getByTestId('ocr-region-rect-0')).toBeTruthy()
    expect(screen.getByTestId('ocr-region-card-0')).toBeTruthy()
    // hover 区域
    fireEvent.mouseEnter(screen.getByTestId('ocr-region-rect-0'))
    await waitFor(() => {
      const card = screen.getByTestId('ocr-region-card-0') as HTMLElement
      expect(card.style.background).toBe('var(--color-primary-bg)')
      expect(card.style.borderColor).toBe('var(--color-primary)')
    })
    // leave 后恢复
    fireEvent.mouseLeave(screen.getByTestId('ocr-region-rect-0'))
    await waitFor(() => {
      const card = screen.getByTestId('ocr-region-card-0') as HTMLElement
      expect(card.style.background).toBe('')
    })
  })

  it('hover 文字卡 → 对应区域 stroke 加粗', async () => {
    render(<OCRPage />)
    const btn = await findRecognizeBtn()
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByTestId('ocr-region-svg')).toBeTruthy())
    fireEvent.mouseEnter(screen.getByTestId('ocr-region-card-1'))
    await waitFor(() => {
      const rect = screen.getByTestId('ocr-region-rect-1') as unknown as SVGElement
      expect(rect.getAttribute('stroke')).toBe('var(--color-primary)')
      expect(rect.getAttribute('stroke-width')).toBe('3')
    })
  })
})
