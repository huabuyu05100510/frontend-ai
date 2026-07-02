// 模型：claude-sonnet-4-6
// useCrossPageHandoff hook tests — build URL + invoke navigate
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Mock react-router-dom's useNavigate so we can inspect calls
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { useCrossPageHandoff } from '../../src/hooks/useCrossPageHandoff'

function Harness() {
  const handoff = useCrossPageHandoff()
  return (
    <div>
      <button data-testid="h-translate" onClick={() => handoff('task-1', 'translate')}>translate</button>
      <button data-testid="h-qc" onClick={() => handoff('task-2', 'qc', { text: 'hello' })}>qc</button>
      <button data-testid="h-ocr-src" onClick={() => handoff('task-3', 'ocr', { src: 'en' })}>ocr</button>
    </div>
  )
}

describe('useCrossPageHandoff', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('builds a URL with task and target translate', () => {
    const { result } = renderHook(() => useCrossPageHandoff())
    act(() => {
      result.current('task-1', 'translate')
    })
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const url = mockNavigate.mock.calls[0][0] as string
    expect(url).toContain('/translate')
    expect(url).toContain('task=task-1')
  })

  it('navigates when called from a React component', () => {
    const { getByTestId } = render(
      <MemoryRouter><Routes><Route path="*" element={<Harness />} /></Routes></MemoryRouter>
    )
    fireEvent.click(getByTestId('h-qc'))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    const url = mockNavigate.mock.calls[0][0] as string
    expect(url).toContain('/qc')
    expect(url).toContain('task=task-2')
    expect(url).toContain('text=hello')
  })

  it('supports custom src param for OCR target', () => {
    const { getByTestId } = render(
      <MemoryRouter><Routes><Route path="*" element={<Harness />} /></Routes></MemoryRouter>
    )
    fireEvent.click(getByTestId('h-ocr-src'))
    const url = mockNavigate.mock.calls[0][0] as string
    expect(url).toContain('/ocr')
    expect(url).toContain('task=task-3')
    expect(url).toContain('src=en')
  })
})