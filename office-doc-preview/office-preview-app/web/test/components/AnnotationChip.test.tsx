// 模型：claude-sonnet-4-6
// AnnotationChip — small badge for inline annotation display
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AnnotationChip } from '../../src/components/AnnotationChip'

describe('AnnotationChip', () => {
  afterEach(() => cleanup())

  it('renders align_fix kind with correct color class', () => {
    const { container } = render(<AnnotationChip kind="align_fix" />)
    const chip = screen.getByTestId('oa-annotation-chip-align_fix')
    expect(chip).toBeTruthy()
    expect(chip.className).toContain('oa-annotation-chip')
    expect(chip.className).toContain('oa-annotation-chip-kind-align')
  })

  it('renders seg_rating kind with correct color class', () => {
    render(<AnnotationChip kind="seg_rating" />)
    const chip = screen.getByTestId('oa-annotation-chip-seg_rating')
    expect(chip.className).toContain('oa-annotation-chip-kind-seg')
  })

  it('renders alt_trans kind with correct color class', () => {
    render(<AnnotationChip kind="alt_trans" />)
    const chip = screen.getByTestId('oa-annotation-chip-alt_trans')
    expect(chip.className).toContain('oa-annotation-chip-kind-alt')
  })

  it('shows count badge when count > 1', () => {
    render(<AnnotationChip kind="alt_trans" count={5} />)
    const chip = screen.getByTestId('oa-annotation-chip-alt_trans')
    expect(chip.textContent).toContain('5')
    // Badge data-testid
    const badge = chip.querySelector('[data-testid="oa-annotation-chip-badge"]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe('5')
  })

  it('hides badge when count <= 1', () => {
    const { container } = render(<AnnotationChip kind="alt_trans" count={1} />)
    const chip = screen.getByTestId('oa-annotation-chip-alt_trans')
    expect(chip.querySelector('[data-testid="oa-annotation-chip-badge"]')).toBeNull()
  })

  it('applies is-active class when active=true', () => {
    render(<AnnotationChip kind="alt_trans" active />)
    const chip = screen.getByTestId('oa-annotation-chip-alt_trans')
    expect(chip.className).toContain('is-active')
  })

  it('does not apply is-active when active is undefined', () => {
    render(<AnnotationChip kind="alt_trans" />)
    const chip = screen.getByTestId('oa-annotation-chip-alt_trans')
    expect(chip.className).not.toContain('is-active')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<AnnotationChip kind="alt_trans" onClick={onClick} segmentId="s_5" />)
    fireEvent.click(screen.getByTestId('oa-annotation-chip-alt_trans'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('logs ISO observability message on click', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    render(<AnnotationChip kind="alt_trans" segmentId="s_5" />)
    fireEvent.click(screen.getByTestId('oa-annotation-chip-alt_trans'))
    const logs = info.mock.calls.map(c => String(c[0]))
    expect(logs.some(l => l.includes('[translate-annotation') && l.includes('action=chip') && l.includes('kind=alt_trans') && l.includes('segId=s_5'))).toBe(true)
    info.mockRestore()
  })

  it('uses semantic token CSS variables for background', () => {
    const { container } = render(<AnnotationChip kind="align_fix" />)
    const chip = screen.getByTestId('oa-annotation-chip-align_fix')
    // chip should reference var(--color-annotation-kind-align) somewhere via inline or class
    const style = chip.getAttribute('style') ?? ''
    expect(style).toContain('var(--color-annotation-kind-align)')
  })

  it('has role=button and accessible label', () => {
    render(<AnnotationChip kind="alt_trans" segmentId="s_5" />)
    const chip = screen.getByTestId('oa-annotation-chip-alt_trans')
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.getAttribute('aria-label')).toBeTruthy()
  })
})