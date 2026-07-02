// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DocTranslateMemoryPanel } from '../../src/components/DocTranslateMemoryPanel'

describe('DocTranslateMemoryPanel', () => {
  it('renders panel header and threshold slider', () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-tm-count': '0' }),
      json: async () => ({ items: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateMemoryPanel sourceLang="zh-CN" targetLang="en" />)
    expect(screen.getByTestId('doc-translate-memory-panel')).toBeTruthy()
    expect(screen.getByTestId('doc-translate-memory-threshold')).toBeTruthy()
  })

  it('lists TM entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-tm-count': '1' }),
      json: async () => ({ items: [{ id: 'tm1', sourceLang: 'zh-CN', targetLang: 'en', source: '你好', target: 'Hello', score: 0.9 }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateMemoryPanel sourceLang="zh-CN" targetLang="en" />)
    await waitFor(() => expect(screen.getByTestId('doc-translate-memory-row-tm1')).toBeTruthy())
  })

  it('updates threshold via slider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-tm-count': '0' }),
      json: async () => ({ items: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateMemoryPanel sourceLang="zh-CN" targetLang="en" />)
    const slider = screen.getByTestId('doc-translate-memory-threshold') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.85' } })
    expect(slider.value).toBe('0.85')
  })

  it('shows empty state when no TM entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-tm-count': '0' }),
      json: async () => ({ items: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateMemoryPanel sourceLang="zh-CN" targetLang="en" />)
    await waitFor(() => expect(screen.getByTestId('doc-translate-memory-empty')).toBeTruthy())
  })
})
