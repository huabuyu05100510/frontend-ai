// QualityCheckPage: hover card → 对应 token 滚动入视；hover token → 对应 card 滚动入视
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QualityCheckPage } from '../src/pages/QualityCheckPage'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
    const u = url.startsWith('http') ? url : 'http://test' + url
    const p = new URL(u).pathname
    const method = (init?.method || 'GET').toUpperCase()
    if (p.startsWith('/api/sample/') && method === 'GET') {
      return new Response('ABCDEFGH测试文字XYZ', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    if (p === '/api/inspect/quality-check' && method === 'POST') {
      return new Response(JSON.stringify({
        engine: 'mock-qc', ms: 12,
        errors: [
          { id: 'e_0', original: 'ABC', corrected: '改正甲', type: 'typo', reason: '错别字', position: 0 },
          { id: 'e_1', original: 'XYZ', corrected: '改正乙', type: 'phrase', reason: '表述建议', position: 12 },
        ],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  }) as any)
})

async function waitForEditorAndCheck() {
  render(<QualityCheckPage />)
  await waitFor(() => {
    expect(screen.queryByText('开始校对')).toBeTruthy()
  })
  const btn = screen.getByText('开始校对') as HTMLButtonElement
  await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 3000 })
  fireEvent.click(btn)
  await waitFor(() => {
    expect(screen.queryByTestId('qc-error-card-e_0')).toBeTruthy()
    expect(screen.queryByTestId('qc-error-card-e_1')).toBeTruthy()
  })
}

describe('QualityCheckPage: hover 滚动联动', () => {
  it('hover error card → 对应 token scrollIntoView 被调用', async () => {
    await waitForEditorAndCheck()
    const tokenEl = document.querySelector('.xf-editor-canvas [data-err-id="e_0"]') as HTMLElement
    expect(tokenEl).toBeTruthy()
    const scrollSpy = vi.fn()
    tokenEl.scrollIntoView = scrollSpy

    const card = screen.getByTestId('qc-error-card-e_0')
    fireEvent.mouseEnter(card)

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })
  })

  it('hover token → 对应 error card scrollIntoView 被调用', async () => {
    await waitForEditorAndCheck()
    const card = screen.getByTestId('qc-error-card-e_1')
    const scrollSpy = vi.fn()
    card.scrollIntoView = scrollSpy

    const tokenEl = document.querySelector('.xf-editor-canvas [data-err-id="e_1"]') as HTMLElement
    fireEvent.mouseEnter(tokenEl)

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })
  })

  it('mouse leave 80ms 后再 hover 下一个 → 下一个对应 card 滚动', async () => {
    await waitForEditorAndCheck()
    const card0 = screen.getByTestId('qc-error-card-e_0')
    const card1 = screen.getByTestId('qc-error-card-e_1')
    const scrollSpy0 = vi.fn(); card0.scrollIntoView = scrollSpy0
    const scrollSpy1 = vi.fn(); card1.scrollIntoView = scrollSpy1

    // 触发 token0 hover → card0 滚动
    const token0 = document.querySelector('.xf-editor-canvas [data-err-id="e_0"]') as HTMLElement
    fireEvent.mouseEnter(token0)
    fireEvent.mouseLeave(token0)
    await waitFor(() => expect(scrollSpy0).toHaveBeenCalled())

    // 等过 debounce 窗口
    await new Promise(r => setTimeout(r, 120))

    // 触发 token1 hover → card1 滚动
    const token1 = document.querySelector('.xf-editor-canvas [data-err-id="e_1"]') as HTMLElement
    fireEvent.mouseEnter(token1)
    fireEvent.mouseLeave(token1)
    await waitFor(() => expect(scrollSpy1).toHaveBeenCalled())
  })
})