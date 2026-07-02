// ImageRegionSvgOverlay — 复用 OCRPage SVG 区域渲染
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImageRegionSvgOverlay } from '../../src/components/ImageRegionSvgOverlay'
import type { OCRRegion } from '../../src/types'

const REGIONS: OCRRegion[] = [
  { text: 'Hello', x: 10, y: 20, width: 100, height: 30, confidence: 0.95 },
  { text: 'World', x: 200, y: 50, width: 80, height: 25, confidence: 0.5 },
]

describe('ImageRegionSvgOverlay', () => {
  it('渲染一个 SVG，viewBox 等于 imageSize', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 800 600')
  })

  it('每个 region 渲染一个 rect 元素', () => {
    render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    expect(screen.getByTestId('region-rect-0')).toBeTruthy()
    expect(screen.getByTestId('region-rect-1')).toBeTruthy()
  })

  it('confidence >= 0.9 区域 stroke = var(--color-success)', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const rect = screen.getByTestId('region-rect-0') as unknown as SVGElement
    expect(rect.getAttribute('stroke')).toBe('var(--color-success)')
  })

  it('confidence < 0.7 区域 stroke = var(--color-danger)', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const rect = screen.getByTestId('region-rect-1') as unknown as SVGElement
    expect(rect.getAttribute('stroke')).toBe('var(--color-danger)')
  })

  it('hoveredIdx 时 rect stroke = var(--color-primary) + strokeWidth=3', () => {
    render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={0}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const rect = screen.getByTestId('region-rect-0') as unknown as SVGElement
    expect(rect.getAttribute('stroke')).toBe('var(--color-primary)')
    expect(rect.getAttribute('stroke-width')).toBe('3')
  })

  it('selectedIdx 持久化高亮（同 hover 样式）', () => {
    render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={1}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const rect = screen.getByTestId('region-rect-1') as unknown as SVGElement
    expect(rect.getAttribute('stroke')).toBe('var(--color-primary)')
    expect(rect.getAttribute('stroke-width')).toBe('3')
  })

  it('onHover 在 mouseenter 时被调用', () => {
    const onHover = vi.fn()
    render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={onHover}
        onClick={() => {}}
      />
    )
    fireEvent.mouseEnter(screen.getByTestId('region-rect-0'))
    expect(onHover).toHaveBeenCalledWith(0)
    fireEvent.mouseLeave(screen.getByTestId('region-rect-0'))
    expect(onHover).toHaveBeenCalledWith(null)
  })

  it('onClick 在点击时触发 (传 idx)', () => {
    const onClick = vi.fn()
    render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={onClick}
      />
    )
    fireEvent.click(screen.getByTestId('region-rect-1'))
    expect(onClick).toHaveBeenCalledWith(1)
  })

  it('每个 rect 内含 <title> 元素显示 region 文本 + 置信度', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const rect = container.querySelector('[data-testid="region-rect-0"]') as unknown as SVGElement
    const title = rect.querySelector('title')
    expect(title?.textContent).toContain('Hello')
    expect(title?.textContent).toContain('95%')
  })

  it('默认 showLabels=true → SVG 含 #1 #2 序号文本', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const svg = container.querySelector('svg')
    expect(svg?.textContent).toContain('#1')
    expect(svg?.textContent).toContain('#2')
  })

  it('showLabels=false → 无序号标签', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
        showLabels={false}
      />
    )
    const svg = container.querySelector('svg')
    expect(svg?.textContent).not.toContain('#1')
  })

  it('scanLine=true 默认 → 含 scan-line rect', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
        scanLine
      />
    )
    expect(container.querySelector('[data-testid="scan-line"]')).toBeTruthy()
  })

  it('scanLine=false → 不渲染 scan-line', () => {
    const { container } = render(
      <ImageRegionSvgOverlay
        regions={REGIONS}
        imageSize={{ width: 800, height: 600 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
        scanLine={false}
      />
    )
    expect(container.querySelector('[data-testid="scan-line"]')).toBeNull()
  })

  it('motionEnabled=false → scan-line 不可见 (data-motion=off)', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    try {
      const { container } = render(
        <ImageRegionSvgOverlay
          regions={REGIONS}
          imageSize={{ width: 800, height: 600 }}
          hoveredIdx={null}
          selectedIdx={null}
          onHover={() => {}}
          onClick={() => {}}
          motionEnabled
        />
      )
      const scan = container.querySelector('[data-testid="scan-line"]') as HTMLElement
      expect(scan).toBeTruthy()
      // 当 data-motion=off 时 scan-line 应隐藏（display:none 或 animation:none）
      const cs = window.getComputedStyle(scan)
      // jsdom 计算样式不完整，只断言 animationName 为 none 或 display 为 none
      const hasNoAnim = cs.animationName === 'none' || cs.display === 'none' || scan.getAttribute('data-motion-aware') === 'off'
      expect(hasNoAnim).toBeTruthy()
    } finally {
      document.documentElement.removeAttribute('data-motion')
    }
  })

  it('置信度 0.7..0.9 区间使用 var(--color-warning)', () => {
    const mid: OCRRegion[] = [
      { text: 'Mid', x: 0, y: 0, width: 50, height: 20, confidence: 0.8 },
    ]
    render(
      <ImageRegionSvgOverlay
        regions={mid}
        imageSize={{ width: 200, height: 200 }}
        hoveredIdx={null}
        selectedIdx={null}
        onHover={() => {}}
        onClick={() => {}}
      />
    )
    const rect = screen.getByTestId('region-rect-0') as unknown as SVGElement
    expect(rect.getAttribute('stroke')).toBe('var(--color-warning)')
  })
})
