import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageTransition } from '../../src/motion/primitives/PageTransition'

describe('PageTransition primitive', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders children inside a wrapper', () => {
    render(<PageTransition><span data-testid="page-content">hello</span></PageTransition>)
    expect(screen.getByTestId('page-content')).toBeTruthy()
  })

  it('applies a transition key when routeKey changes', async () => {
    const { rerender } = render(
      <PageTransition routeKey="page-a"><span>a</span></PageTransition>
    )
    rerender(<PageTransition routeKey="page-b"><span>b</span></PageTransition>)
    expect(await screen.findByText('b')).toBeTruthy()
  })

  it('skips animation when <html data-motion="off">', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    render(<PageTransition data-testid="pt"><span>content</span></PageTransition>)
    const el = screen.getByTestId('pt')
    const style = window.getComputedStyle(el)
    expect(parseFloat(style.transitionDuration || '0')).toBeLessThanOrEqual(0.02)
    document.documentElement.removeAttribute('data-motion')
  })
})
