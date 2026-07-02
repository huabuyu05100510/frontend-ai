// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '../../src/components/ThemeToggle'
import { useTheme } from '../../src/hooks/useTheme'

// Wrap ThemeToggle in a harness exposing useTheme so toggle works
function ToggleHarness() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <ThemeToggle onClick={toggleTheme} theme={theme} />
    </div>
  )
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })

  it('renders a button with accessible label', () => {
    render(<ThemeToggle onClick={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toMatch(/theme/i)
  })

  it('clicking the button calls onClick handler', () => {
    let clicked = false
    render(<ThemeToggle onClick={() => { clicked = true }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(clicked).toBe(true)
  })

  it('integrated with useTheme, click flips theme and updates attribute', () => {
    render(<ToggleHarness />)
    expect(screen.getByTestId('current-theme').textContent).toBe('light')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('current-theme').textContent).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
