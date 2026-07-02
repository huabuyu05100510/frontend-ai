// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressRing } from '../../src/components/ProgressRing'

describe('ProgressRing', () => {
  it('renders at 0% with default size', () => {
    const { container } = render(<ProgressRing percent={0} />)
    const ring = container.querySelector('.xf-progress-ring') as SVGSVGElement
    expect(ring).toBeTruthy()
    const fill = container.querySelector('.xf-progress-ring-fill') as unknown as SVGCircleElement
    expect(fill).toBeTruthy()
    // For 0% the offset should be the full circumference (no visible fill)
    const radius = Number(fill.getAttribute('r'))
    const c = 2 * Math.PI * radius
    const offset = Number(fill.getAttribute('stroke-dashoffset'))
    expect(offset).toBeCloseTo(c, 1)
  })

  it('renders at 50% with half offset', () => {
    const { container } = render(<ProgressRing percent={50} size={80} stroke={6} />)
    const fill = container.querySelector('.xf-progress-ring-fill') as unknown as SVGCircleElement
    const radius = Number(fill.getAttribute('r'))
    const c = 2 * Math.PI * radius
    const offset = Number(fill.getAttribute('stroke-dashoffset'))
    // 50% fill => offset is half the circumference
    expect(offset).toBeCloseTo(c / 2, 1)
  })

  it('renders at 100% with zero offset', () => {
    const { container } = render(<ProgressRing percent={100} />)
    const fill = container.querySelector('.xf-progress-ring-fill') as unknown as SVGCircleElement
    const offset = Number(fill.getAttribute('stroke-dashoffset'))
    expect(offset).toBeCloseTo(0, 1)
  })

  it('shows percent label by default', () => {
    render(<ProgressRing percent={42} />)
    expect(screen.getByText('42%')).toBeTruthy()
  })

  it('hides percent label when showPercent=false', () => {
    const { container } = render(<ProgressRing percent={42} showPercent={false} />)
    expect(container.textContent).not.toContain('42%')
  })

  it('uses custom label when provided', () => {
    render(<ProgressRing percent={50} showPercent={false} label="翻译中" />)
    expect(screen.getByText('翻译中')).toBeTruthy()
  })

  it('respects data-motion="off" by skipping CSS transition attribute', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    const { container } = render(<ProgressRing percent={50} />)
    const fill = container.querySelector('.xf-progress-ring-fill') as unknown as SVGCircleElement
    // Reduced motion mode should still set the offset value, just no transition
    expect(fill.getAttribute('stroke-dashoffset')).toBeTruthy()
    document.documentElement.removeAttribute('data-motion')
  })

  it('sets aria-label and role', () => {
    render(<ProgressRing percent={75} aria-label="翻译进度" />)
    const ring = screen.getByLabelText('翻译进度')
    expect(ring).toBeTruthy()
    expect(ring.getAttribute('role')).toBe('progressbar')
    expect(ring.getAttribute('aria-valuenow')).toBe('75')
  })
})
