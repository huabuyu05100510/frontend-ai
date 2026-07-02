// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Palette, usePalette } from '../../src/palette'
import { registerPaletteItems, paletteRegistry } from '../../src/palette/registry'

function Harness({ children }: { children?: React.ReactNode }) {
  const palette = usePalette()
  return (
    <>
      <button data-testid="open" onClick={palette.open}>open</button>
      <Palette palette={palette} />
      {children}
    </>
  )
}

describe('Palette component', () => {
  beforeEach(() => {
    paletteRegistry.clear()
    localStorage.clear()
  })

  it('does not render content when closed', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    expect(screen.queryByTestId('palette-input')).toBeNull()
  })

  it('renders search input when opened', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('open'))
    expect(screen.getByTestId('palette-input')).toBeTruthy()
  })

  it('displays registered items when opened', () => {
    registerPaletteItems([
      { id: 'test-item', title: 'Test Item Visible', group: 'Actions', action: vi.fn() },
    ])
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('open'))
    expect(screen.getByText(/test item visible/i)).toBeTruthy()
  })

  it('filters items based on search input', () => {
    registerPaletteItems([
      { id: 'a', title: 'Open Files', group: 'Navigation', action: vi.fn() },
      { id: 'b', title: 'Run Translate', group: 'Actions', action: vi.fn() },
    ])
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('open'))
    const input = screen.getByTestId('palette-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'files' } })
    expect(screen.getByText(/open files/i)).toBeTruthy()
    expect(screen.queryByText(/run translate/i)).toBeNull()
  })
})