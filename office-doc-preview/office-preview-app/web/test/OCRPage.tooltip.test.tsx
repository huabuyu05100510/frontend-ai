// OCRPage: hover 区域显示 tooltip + 区域序号 #i 标签
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
          { text: 'Hello', x: 100, y: 100, width: 200, height: 40, confidence: 0.95 },
          { text: 'world', x: 320, y: 100, width: 180, height: 40, confidence: 0.42 },
          { text: 'foo', x: 100, y: 160, width: 200, height: 40, confidence: 0.7 },
        ],
        imageSize: { width: 800, height: 600 },
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
})

async function findRecognizeBtn(): Promise<HTMLButtonElement> {
  const btns = await screen.findAllByText('开始识别', {}, { timeout: 3000 })
  const recognize = btns.find(b => b.className.includes('xf-btn-solid')) as HTMLButtonElement
  expect(recognize).toBeTruthy()
  await waitFor(() => expect(recognize).not.toBeDisabled(), { timeout: 3000 })
  return recognize
}

async function gotoOcrDone() {
  render(<OCRPage />)
  const btn = await findRecognizeBtn()
  fireEvent.click(btn)
  await waitFor(() => expect(screen.getByTestId('ocr-region-svg')).toBeTruthy())
}

describe('OCRPage: 区域 Tooltip + 序号标签', () => {
  it('hover 区域 → tooltip 显示文字 + 置信度 + 坐标', async () => {
    await gotoOcrDone()
    fireEvent.mouseEnter(screen.getByTestId('ocr-region-rect-0'))
    await waitFor(() => {
      const tip = screen.getByTestId('ocr-region-tooltip')
      expect(tip.textContent).toContain('Hello')
      expect(tip.textContent).toContain('95%')
      expect(tip.textContent).toContain('x=100')
    })
  })

  it('leave 区域 → tooltip 消失', async () => {
    await gotoOcrDone()
    fireEvent.mouseEnter(screen.getByTestId('ocr-region-rect-0'))
    await waitFor(() => expect(screen.queryByTestId('ocr-region-tooltip')).toBeTruthy())
    fireEvent.mouseLeave(screen.getByTestId('ocr-region-rect-0'))
    await waitFor(() => expect(screen.queryByTestId('ocr-region-tooltip')).toBeNull())
  })

  it('SVG rect 有 native <title> 元素显示区域文本', async () => {
    await gotoOcrDone()
    const rect = screen.getByTestId('ocr-region-rect-0') as unknown as SVGElement
    const title = rect.querySelector('title')
    expect(title?.textContent).toContain('Hello')
    expect(title?.textContent).toContain('95%')
  })

  it('SVG 内显示区域序号标签 (#1 #2 #3)', async () => {
    await gotoOcrDone()
    const svg = screen.getByTestId('ocr-region-svg')
    expect(svg.textContent).toContain('#1')
    expect(svg.textContent).toContain('#2')
    expect(svg.textContent).toContain('#3')
  })
})