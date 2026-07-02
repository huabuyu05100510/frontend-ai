// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DocTranslateGlossaryPanel } from '../../src/components/DocTranslateGlossaryPanel'

describe('DocTranslateGlossaryPanel', () => {
  it('renders panel header and import button', () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }),
      json: async () => ({ items: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateGlossaryPanel sourceLang="zh-CN" targetLang="en" onApplyToTranslate={vi.fn()} />)
    expect(screen.getByTestId('doc-translate-glossary-panel')).toBeTruthy()
    expect(screen.getByTestId('doc-translate-glossary-import')).toBeTruthy()
  })

  it('lists terms after loading', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '1' }),
      json: async () => ({ items: [{ id: 'g1', sourceLang: 'zh-CN', targetLang: 'en', source: '苹果', target: 'Apple' }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateGlossaryPanel sourceLang="zh-CN" targetLang="en" onApplyToTranslate={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('doc-translate-glossary-row-g1')).toBeTruthy())
  })

  it('triggers CSV import via file input', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }), json: async () => ({ items: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'x-glossary-imported-count': '2', 'x-glossary-duplicates': '0' }), json: async () => ({ imported: 2, duplicates: 0 }) } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateGlossaryPanel sourceLang="zh-CN" targetLang="en" onApplyToTranslate={vi.fn()} />)
    const file = new File(['source,target\n苹果,Apple\n香蕉,Banana\n'], 'terms.csv', { type: 'text/csv' })
    const input = screen.getByTestId('doc-translate-glossary-file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1))
  })

  it('applies glossary to translation (notify parent)', async () => {
    const onApply = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }),
      json: async () => ({ items: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateGlossaryPanel sourceLang="zh-CN" targetLang="en" onApplyToTranslate={onApply} />)
    await waitFor(() => expect(screen.getByTestId('doc-translate-glossary-apply')).toBeTruthy())
    fireEvent.click(screen.getByTestId('doc-translate-glossary-apply'))
    expect(onApply).toHaveBeenCalled()
  })

  it('shows empty state when no terms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'x-glossary-count': '0' }),
      json: async () => ({ items: [] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<DocTranslateGlossaryPanel sourceLang="zh-CN" targetLang="en" onApplyToTranslate={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('doc-translate-glossary-empty')).toBeTruthy())
  })
})
