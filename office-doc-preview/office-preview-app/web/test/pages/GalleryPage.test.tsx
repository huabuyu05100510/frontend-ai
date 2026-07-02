// 模型：claude-sonnet-4-6
// GalleryPage tests
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { GalleryPage } from '../../src/pages/GalleryPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('GalleryPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders title 图片画廊', () => {
    render(
      <MemoryRouter initialEntries={['/gallery']}>
        <Routes><Route path="*" element={<GalleryPage />} /></Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('图片画廊')).toBeTruthy()
  })

  it('shows empty state when no images', () => {
    render(
      <MemoryRouter initialEntries={['/gallery']}>
        <Routes><Route path="*" element={<GalleryPage />} /></Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/暂无图片资产/)).toBeTruthy()
  })

  it('clicking an image card opens a lightbox', () => {
    render(
      <MemoryRouter initialEntries={['/gallery']}>
        <Routes><Route path="*" element={<GalleryPage />} /></Routes>
      </MemoryRouter>
    )
    const img = screen.getByTestId('gallery-card-fixture')
    fireEvent.click(img)
    // Lightbox overlay should appear
    expect(screen.getByTestId('gallery-lightbox')).toBeTruthy()
  })
})