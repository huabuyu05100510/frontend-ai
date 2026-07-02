// 模型：claude-sonnet-4-6
// BookmarksPage tests
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useStore } from '../../src/store'
import { BookmarksPage } from '../../src/pages/BookmarksPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('BookmarksPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    useStore.setState({
      bookmarks: new Set<string>(),
      tasks: [
        { id: 't1', name: '已收藏文件', ext: 'pdf', size: 100, status: 'ready', convertStatus: 'done', createdAt: Date.now() } as any,
        { id: 't2', name: '未收藏文件', ext: 'docx', size: 200, status: 'ready', convertStatus: 'done', createdAt: Date.now() } as any,
      ],
    } as any)
  })

  it('renders title 收藏夹', () => {
    render(
      <MemoryRouter initialEntries={['/bookmarks']}>
        <Routes><Route path="*" element={<BookmarksPage />} /></Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('收藏夹')).toBeTruthy()
  })

  it('shows empty state when no bookmarks', () => {
    render(
      <MemoryRouter initialEntries={['/bookmarks']}>
        <Routes><Route path="*" element={<BookmarksPage />} /></Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/在文档预览中点击星标即可收藏/)).toBeTruthy()
  })

  it('clicking a bookmarked task card navigates to /files?task=<id>', () => {
    useStore.setState({ bookmarks: new Set(['t1']) } as any)
    render(
      <MemoryRouter initialEntries={['/bookmarks']}>
        <Routes><Route path="*" element={<BookmarksPage />} /></Routes>
      </MemoryRouter>
    )
    const card = screen.getByTestId('bookmark-card-t1')
    fireEvent.click(card)
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const url = mockNavigate.mock.calls[0][0] as string
    expect(url).toContain('/files')
    expect(url).toContain('task=t1')
  })
})