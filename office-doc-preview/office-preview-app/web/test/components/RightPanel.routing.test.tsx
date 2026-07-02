// 模型：claude-sonnet-4-6
// RightPanel routing — onSelectTask navigates to /files?task=...
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { RightPanel } from '../../src/components/RightPanel'

const TASKS = [
  { id: 't-1', name: '任务一', status: 'ready', createdAt: Date.now() },
  { id: 't-2', name: '任务二', status: 'pending', createdAt: Date.now() },
]

describe('RightPanel routing', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('clicking a task item navigates to /files?task=<id>', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<RightPanel tasks={TASKS} />} />
        </Routes>
      </MemoryRouter>
    )
    // Click first task
    const btns = screen.getAllByRole('button')
    fireEvent.click(btns[0])
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const url = mockNavigate.mock.calls[0][0] as string
    expect(url).toContain('/files')
    expect(url).toContain('task=t-1')
  })

  it('footer "查看全部" link navigates to /files', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<RightPanel tasks={TASKS} />} />
        </Routes>
      </MemoryRouter>
    )
    const footer = screen.getByTestId('rightpanel-view-all')
    fireEvent.click(footer)
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate.mock.calls[0][0]).toBe('/files')
  })
})