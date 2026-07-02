import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { Hover } from '../../src/motion/primitives/Hover'

describe('Hover primitive', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders children without throwing', () => {
    render(<Hover><span data-testid="child">x</span></Hover>)
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('fires onHover callback on pointer enter', () => {
    const onHover = vi.fn()
    render(<Hover onHover={onHover}><span data-testid="target">x</span></Hover>)
    fireEvent.pointerEnter(screen.getByTestId('target'))
    expect(onHover).toHaveBeenCalledOnce()
  })

  it('fires onUnhover callback on pointer leave', () => {
    const onUnhover = vi.fn()
    render(<Hover onUnhover={onUnhover}><span data-testid="target">x</span></Hover>)
    fireEvent.pointerEnter(screen.getByTestId('target'))
    fireEvent.pointerLeave(screen.getByTestId('target'))
    expect(onUnhover).toHaveBeenCalledOnce()
  })

  it('does not animate when <html data-motion="off"> is set', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    render(<Hover data-testid="h"><span>content</span></Hover>)
    const el = screen.getByTestId('h')
    // when motion off, animation should be 0 duration
    const style = window.getComputedStyle(el)
    expect(parseFloat(style.transitionDuration || '0')).toBeLessThanOrEqual(0.02)
    document.documentElement.removeAttribute('data-motion')
  })
})
