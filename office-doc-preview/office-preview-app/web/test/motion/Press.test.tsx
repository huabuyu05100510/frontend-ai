import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { Press } from '../../src/motion/primitives/Press'

describe('Press primitive', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders children', () => {
    render(<Press><span data-testid="c">x</span></Press>)
    expect(screen.getByTestId('c')).toBeTruthy()
  })

  it('fires onPressStart on pointer down', () => {
    const onPressStart = vi.fn()
    render(<Press onPressStart={onPressStart}><span data-testid="t">x</span></Press>)
    fireEvent.pointerDown(screen.getByTestId('t'))
    expect(onPressStart).toHaveBeenCalledOnce()
  })

  it('fires onPressEnd on pointer up', () => {
    const onPressEnd = vi.fn()
    render(<Press onPressEnd={onPressEnd}><span data-testid="t">x</span></Press>)
    fireEvent.pointerDown(screen.getByTestId('t'))
    fireEvent.pointerUp(screen.getByTestId('t'))
    expect(onPressEnd).toHaveBeenCalledOnce()
  })

  it('does not animate when <html data-motion="off">', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    render(<Press data-testid="p"><span>content</span></Press>)
    const el = screen.getByTestId('p')
    const style = window.getComputedStyle(el)
    expect(parseFloat(style.transitionDuration || '0')).toBeLessThanOrEqual(0.02)
    document.documentElement.removeAttribute('data-motion')
  })
})
