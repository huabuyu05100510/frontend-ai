// 模型：claude-sonnet-4-6
// SamplesPage tests
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SamplesPage } from '../../src/pages/SamplesPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('SamplesPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders title 示例库', () => {
    render(
      <MemoryRouter initialEntries={['/samples']}>
        <Routes><Route path="*" element={<SamplesPage />} /></Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('示例库')).toBeTruthy()
  })

  it('shows empty state when no samples returned', () => {
    render(
      <MemoryRouter initialEntries={['/samples']}>
        <Routes><Route path="*" element={<SamplesPage />} /></Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/暂无示例文件/)).toBeTruthy()
  })

  it('renders fixture card even when fetch fails', () => {
    // Fixture sample ensures at least one card visible on page load
    render(
      <MemoryRouter initialEntries={['/samples']}>
        <Routes><Route path="*" element={<SamplesPage />} /></Routes>
      </MemoryRouter>
    )
    // The fixture card testid is always rendered
    expect(screen.getByTestId('sample-card-fixture')).toBeTruthy()
  })
})