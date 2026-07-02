// ConfidenceDot — confidence 颜色阈值 + 可选数值标签
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfidenceDot } from '../../src/components/ConfidenceDot'

describe('ConfidenceDot', () => {
  it('confidence >= 0.9 → 绿色 (var(--color-success))', () => {
    const { container } = render(<ConfidenceDot confidence={0.95} />)
    const dot = container.querySelector('[data-testid="confidence-dot"]') as HTMLElement
    expect(dot).toBeTruthy()
    expect(dot.style.background).toBe('var(--color-success)')
  })

  it('confidence >= 0.7 且 < 0.9 → 琥珀 (var(--color-warning))', () => {
    const { container } = render(<ConfidenceDot confidence={0.75} />)
    const dot = container.querySelector('[data-testid="confidence-dot"]') as HTMLElement
    expect(dot.style.background).toBe('var(--color-warning)')
  })

  it('confidence < 0.7 → 红色 (var(--color-danger))', () => {
    const { container } = render(<ConfidenceDot confidence={0.5} />)
    const dot = container.querySelector('[data-testid="confidence-dot"]') as HTMLElement
    expect(dot.style.background).toBe('var(--color-danger)')
  })

  it('boundary 0.9 仍为绿色 (>=)', () => {
    const { container } = render(<ConfidenceDot confidence={0.9} />)
    const dot = container.querySelector('[data-testid="confidence-dot"]') as HTMLElement
    expect(dot.style.background).toBe('var(--color-success)')
  })

  it('boundary 0.7 为琥珀 (>=)', () => {
    const { container } = render(<ConfidenceDot confidence={0.7} />)
    const dot = container.querySelector('[data-testid="confidence-dot"]') as HTMLElement
    expect(dot.style.background).toBe('var(--color-warning)')
  })

  it('showValue=true 时显示百分比文字', () => {
    render(<ConfidenceDot confidence={0.85} showValue />)
    expect(screen.getByText('85%')).toBeTruthy()
  })

  it('默认不显示数值', () => {
    const { container } = render(<ConfidenceDot confidence={0.5} />)
    expect(container.textContent).not.toContain('%')
  })

  it('自定义 size 生效 (width/height)', () => {
    const { container } = render(<ConfidenceDot confidence={0.95} size={16} />)
    const dot = container.querySelector('[data-testid="confidence-dot"]') as HTMLElement
    expect(dot.style.width).toBe('16px')
    expect(dot.style.height).toBe('16px')
  })
})
