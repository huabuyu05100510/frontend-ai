// 模型：claude-sonnet-4-6
// ImagePreviewPane component tests — zoom slider + grid overlay + status bar + region overlay
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImagePreviewPane } from '../../src/components/ImagePreviewPane'
import type { OCRRegion } from '../../src/types'

describe('ImagePreviewPane', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-png'], { type: 'image/png' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders img with src from /api/inspect/translate/render-image', () => {
    render(<ImagePreviewPane taskId="t_img" page={1} />)
    const img = screen.getByRole('img', { name: /原图预览/ }) as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.src).toContain('/api/inspect/translate/render-image')
    expect(img.src).toContain('task=t_img')
    expect(img.src).toContain('page=1')
  })

  it('zoom slider scales the canvas (CSS transform)', () => {
    const { container } = render(<ImagePreviewPane taskId="t_z" zoom={1.5} />)
    const canvas = container.querySelector('.oa-image-preview-canvas') as HTMLElement
    expect(canvas).toBeTruthy()
    // CSS transform applied to canvas wrapper
    const wrapper = container.querySelector('.oa-image-preview-stage') as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.style.transform).toContain('scale(1.5)')
  })

  it('grid toggle shows overlay', () => {
    const { container } = render(<ImagePreviewPane taskId="t_g" showGrid />)
    const overlay = container.querySelector('[data-testid="oa-image-preview-grid-overlay"]') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(container.querySelector('.oa-image-preview-grid')).toBeTruthy()
  })

  it('grid hidden by default', () => {
    const { container } = render(<ImagePreviewPane taskId="t_g" />)
    expect(container.querySelector('[data-testid="oa-image-preview-grid-overlay"]')).toBeNull()
  })

  it('grid toggle button toggles overlay state', () => {
    const { container } = render(<ImagePreviewPane taskId="t_t" />)
    const toggle = container.querySelector('[data-testid="oa-image-preview-grid-toggle"]') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(container.querySelector('[data-testid="oa-image-preview-grid-overlay"]')).toBeNull()
    fireEvent.click(toggle)
    expect(container.querySelector('[data-testid="oa-image-preview-grid-overlay"]')).toBeTruthy()
    fireEvent.click(toggle)
    expect(container.querySelector('[data-testid="oa-image-preview-grid-overlay"]')).toBeNull()
  })

  it('status bar shows zoom/grid/page text', () => {
    const { container } = render(<ImagePreviewPane taskId="t_s" zoom={1.2} showGrid page={2} />)
    const status = container.querySelector('[data-testid="oa-image-preview-status"]') as HTMLElement
    expect(status).toBeTruthy()
    const text = status.textContent || ''
    expect(text).toContain('120%')
    expect(text).toContain('第 2 页')
    expect(text).toMatch(/网格/)
  })

  it('page prop changes URL query', () => {
    render(<ImagePreviewPane taskId="t_p" page={3} />)
    const img = screen.getByRole('img', { name: /原图预览/ }) as HTMLImageElement
    expect(img.src).toContain('page=3')
  })

  it('OCR region overlay renders rect count matching regions', () => {
    const regions: OCRRegion[] = [
      { text: '标题', x: 10, y: 10, width: 200, height: 40, confidence: 0.95 },
      { text: '正文', x: 10, y: 60, width: 300, height: 20, confidence: 0.85 },
      { text: '页脚', x: 10, y: 90, width: 100, height: 20, confidence: 0.65 },
    ]
    const { container } = render(
      <ImagePreviewPane taskId="t_o" regions={regions} />
    )
    const overlay = container.querySelector('[data-testid="oa-image-preview-region-overlay"]') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay.querySelectorAll('rect').length).toBe(3)
  })

  it('onRegionHover callback fires on mouse enter/leave', () => {
    const onHover = vi.fn()
    const regions: OCRRegion[] = [
      { text: 'A', x: 0, y: 0, width: 100, height: 30, confidence: 0.9 },
    ]
    const { container } = render(
      <ImagePreviewPane taskId="t_h" regions={regions} onRegionHover={onHover} />
    )
    const rect = container.querySelector('[data-testid="oa-image-preview-region-rect-0"]') as SVGRectElement
    expect(rect).toBeTruthy()
    fireEvent.mouseEnter(rect)
    expect(onHover).toHaveBeenCalledWith('0')
    fireEvent.mouseLeave(rect)
    expect(onHover).toHaveBeenCalledWith(null)
  })

  it('loading="lazy" on image', () => {
    render(<ImagePreviewPane taskId="t_l" />)
    const img = screen.getByRole('img', { name: /原图预览/ }) as HTMLImageElement
    expect(img.getAttribute('loading')).toBe('lazy')
  })
})