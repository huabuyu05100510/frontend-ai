import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MotionProvider } from '../../src/motion/MotionProvider'

describe('MotionProvider', () => {
  it('renders children without throwing', () => {
    const { getByText } = render(
      <MotionProvider>
        <div>hello motion</div>
      </MotionProvider>
    )
    expect(getByText('hello motion')).toBeTruthy()
  })

  it('does not inject any markup that wraps children', () => {
    const { container } = render(
      <MotionProvider>
        <span data-testid="child">x</span>
      </MotionProvider>
    )
    expect(container.querySelector('[data-testid="child"]')).toBeTruthy()
  })
})
