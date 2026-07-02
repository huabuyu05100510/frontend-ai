// 模型：claude-sonnet-4-6
// DocPreviewPane component tests — source/target/dual 双栏预览
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DocPreviewPane } from '../../src/components/DocPreviewPane'

describe('DocPreviewPane', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => new Blob(['fake-png'], { type: 'image/png' }),
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders placeholder when no taskId provided', () => {
    const { container } = render(<DocPreviewPane />)
    const root = container.querySelector('[data-testid="oa-doc-preview"]') as HTMLElement
    expect(root).toBeTruthy()
    // placeholder copy
    expect(within(root).getByText(/请先选择文件/)).toBeTruthy()
    // no page image rendered
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders single page in source mode (default pageRange=[1,2] → 2 pages)', () => {
    const { container } = render(<DocPreviewPane taskId="t_1" mode="source" />)
    const root = container.querySelector('[data-testid="oa-doc-preview"]') as HTMLElement
    expect(root.getAttribute('data-mode')).toBe('source')
    // 2 pages by default
    expect(container.querySelectorAll('[data-testid^="oa-doc-preview-page-"]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="oa-doc-preview-page-1"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="oa-doc-preview-page-2"]')).toBeTruthy()
  })

  it('source mode renders preview images with correct src', () => {
    const { container } = render(<DocPreviewPane taskId="t_abc" mode="source" pageRange={[1, 1]} />)
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.src).toContain('/api/files/t_abc/preview')
    expect(img.src).toContain('as=page')
    expect(img.src).toContain('n=1')
  })

  it('target mode shows download button only when onDownload provided', () => {
    const onDownload = vi.fn()
    const { container, rerender } = render(<DocPreviewPane taskId="t_1" mode="target" />)
    expect(container.querySelector('[data-testid="oa-doc-preview-download"]')).toBeNull()

    rerender(<DocPreviewPane taskId="t_1" mode="target" onDownload={onDownload} />)
    const btn = container.querySelector('[data-testid="oa-doc-preview-download"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('dual mode renders 2-column grid with both source and target images', () => {
    const onDownload = vi.fn()
    const { container } = render(
      <DocPreviewPane taskId="t_d" mode="dual" pageRange={[1, 1]} onDownload={onDownload} />
    )
    const root = container.querySelector('[data-testid="oa-doc-preview"]') as HTMLElement
    expect(root.getAttribute('data-mode')).toBe('dual')
    // grid container
    const grid = container.querySelector('.oa-doc-preview-grid') as HTMLElement
    expect(grid).toBeTruthy()
    // 2 columns (source + target) × 1 page
    const columns = grid.querySelectorAll('.oa-doc-preview-column')
    expect(columns.length).toBe(2)
    // each column has 1 image
    expect(grid.querySelectorAll('img')).toHaveLength(2)
  })

  it('pageRange=[1,3] renders 3 pages', () => {
    const { container } = render(<DocPreviewPane taskId="t_3" mode="source" pageRange={[1, 3]} />)
    expect(container.querySelectorAll('[data-testid^="oa-doc-preview-page-"]')).toHaveLength(3)
    for (let i = 1; i <= 3; i++) {
      expect(container.querySelector(`[data-testid="oa-doc-preview-page-${i}"]`)).toBeTruthy()
    }
  })

  it('images use loading="lazy" for performance', () => {
    const { container } = render(<DocPreviewPane taskId="t_lazy" mode="source" pageRange={[1, 2]} />)
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBeGreaterThan(0)
    imgs.forEach((img) => {
      expect(img.getAttribute('loading')).toBe('lazy')
    })
  })

  it('fetches preview via correct URL containing taskId and page number', () => {
    render(<DocPreviewPane taskId="t_zzz" mode="source" pageRange={[1, 2]} />)
    const imgs = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgs.length).toBe(2)
    expect(imgs[0].src).toContain('/api/files/t_zzz/preview')
    expect(imgs[0].src).toContain('n=1')
    expect(imgs[1].src).toContain('n=2')
  })
})