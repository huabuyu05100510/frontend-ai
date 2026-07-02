// ImageDualView — 三种视图模式 (overlay / stacked / original)
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImageDualView } from '../../src/components/ImageDualView'
import type { OCRRegion } from '../../src/types'

const REGIONS: OCRRegion[] = [
  { text: 'Hello', x: 10, y: 20, width: 100, height: 30, confidence: 0.95 },
  { text: 'World', x: 200, y: 50, width: 80, height: 25, confidence: 0.5 },
]

const baseProps = {
  imageSrc: '/test.png',
  imageSize: { width: 800, height: 600 },
  regions: REGIONS,
  translations: { 0: '你好', 1: '世界' },
  selectedIdx: null as number | null,
  hoveredIdx: null as number | null,
  onSelectRegion: () => {},
  onHoverRegion: () => {},
  onCopyAll: () => {},
  onSaveBilingual: () => {},
}

describe('ImageDualView', () => {
  it('overlay 模式：渲染 img + SVG 区域 + 工具按钮', () => {
    render(<ImageDualView {...baseProps} viewMode="overlay" />)
    const img = screen.getByTestId('image-dual-img')
    expect(img).toBeTruthy()
    expect((img as HTMLImageElement).src).toContain('/test.png')
    expect(screen.getByTestId('image-dual-svg')).toBeTruthy()
    expect(screen.getByTestId('image-dual-copy-all')).toBeTruthy()
    expect(screen.getByTestId('image-dual-save-bilingual')).toBeTruthy()
  })

  it('stacked 模式：渲染 img + 翻译列表', () => {
    const { container } = render(<ImageDualView {...baseProps} viewMode="stacked" />)
    expect(screen.getByTestId('image-dual-img')).toBeTruthy()
    expect(container.querySelector('.image-dual-stack')).toBeTruthy()
    // 翻译列表有 2 个 item
    const items = container.querySelectorAll('[data-testid^="stack-item-"]')
    expect(items.length).toBe(2)
  })

  it('stacked 模式：翻译列表显示 译文', () => {
    render(<ImageDualView {...baseProps} viewMode="stacked" />)
    expect(screen.getByTestId('stack-item-0').textContent).toContain('你好')
    expect(screen.getByTestId('stack-item-1').textContent).toContain('世界')
  })

  it('stacked 模式：未翻译 region 显示「⏳」', () => {
    render(<ImageDualView {...baseProps} viewMode="stacked" translations={{ 0: '你好' }} />)
    expect(screen.getByTestId('stack-item-1').textContent).toContain('⏳')
  })

  it('original 模式：仅渲染 img，无 SVG 区域', () => {
    const { container } = render(<ImageDualView {...baseProps} viewMode="original" />)
    expect(screen.getByTestId('image-dual-img')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('onSelectRegion 在点击区域时触发', () => {
    const onSelectRegion = vi.fn()
    render(<ImageDualView {...baseProps} viewMode="overlay" onSelectRegion={onSelectRegion} />)
    fireEvent.click(screen.getByTestId('region-rect-0'))
    expect(onSelectRegion).toHaveBeenCalledWith(0)
  })

  it('onHoverRegion 在 hover 区域时触发', () => {
    const onHoverRegion = vi.fn()
    render(<ImageDualView {...baseProps} viewMode="overlay" onHoverRegion={onHoverRegion} />)
    fireEvent.mouseEnter(screen.getByTestId('region-rect-0'))
    expect(onHoverRegion).toHaveBeenCalledWith(0)
  })

  it('onCopyAll 在「复制全部」按钮点击时触发', () => {
    const onCopyAll = vi.fn()
    render(<ImageDualView {...baseProps} viewMode="overlay" onCopyAll={onCopyAll} />)
    fireEvent.click(screen.getByTestId('image-dual-copy-all'))
    expect(onCopyAll).toHaveBeenCalled()
  })

  it('onSaveBilingual 在「保存双语图」按钮点击时触发', () => {
    const onSaveBilingual = vi.fn()
    render(<ImageDualView {...baseProps} viewMode="overlay" onSaveBilingual={onSaveBilingual} />)
    fireEvent.click(screen.getByTestId('image-dual-save-bilingual'))
    expect(onSaveBilingual).toHaveBeenCalled()
  })

  it('overlay 模式：selectedIdx 区域加粗 stroke', () => {
    render(<ImageDualView {...baseProps} viewMode="overlay" selectedIdx={1} />)
    const rect = screen.getByTestId('region-rect-1') as unknown as SVGElement
    expect(rect.getAttribute('stroke')).toBe('var(--color-primary)')
    expect(rect.getAttribute('stroke-width')).toBe('3')
  })

  it('无 imageSrc 时不渲染 img', () => {
    const { container } = render(
      <ImageDualView {...baseProps} imageSrc="" viewMode="overlay" />
    )
    expect(container.querySelector('img')).toBeNull()
  })
})
