import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'

function Redirect() {
  return <Navigate to="/files" replace />
}

describe('root redirect', () => {
  it('/ redirects to /files via Navigate', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Redirect />} />
          <Route path="/files" element={<div data-testid="files-page">Files</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('files-page')).toBeTruthy()
  })
})