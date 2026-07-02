import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'

function NavigateProbe() {
  const navigate = useNavigate()
  const loc = useLocation()
  return (
    <div>
      <div data-testid="pathname">{loc.pathname}</div>
      <button onClick={() => navigate('/translate')}>go translate</button>
      <button onClick={() => navigate('/qc')}>go qc</button>
    </div>
  )
}

describe('router navigation', () => {
  it('useNavigate changes the URL', () => {
    render(
      <MemoryRouter initialEntries={['/files']}>
        <Routes>
          <Route path="*" element={<NavigateProbe />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('pathname').textContent).toBe('/files')
    fireEvent.click(screen.getByText('go translate'))
    expect(screen.getByTestId('pathname').textContent).toBe('/translate')
  })

  it('MemoryRouter can simulate browser back via initialEntries', () => {
    render(
      <MemoryRouter initialEntries={['/files', '/translate']} initialIndex={0}>
        <Routes>
          <Route path="*" element={<NavigateProbe />} />
        </Routes>
      </MemoryRouter>
    )
    // Initial entry is /files
    expect(screen.getByTestId('pathname').textContent).toBe('/files')
  })
})