// QualityCheckPage: token ↔ error card hover + 改正后双栏
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
    // 样例：mock 返回固定文本
    if (p.startsWith('/api/sample/') && method === 'GET') {
      return new Response('ABCDEFGH测试文字XYZ', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    // 校对 API：返回 2 处错误
    if (p === '/api/inspect/quality-check' && method === 'POST') {
      return new Response(JSON.stringify({
        engine: 'mock-qc', ms: 12,
        errors: [
          { id: 'e_0', original: 'ABC', corrected: '改正甲', type: 'typo', reason: '错别字', position: 0 },
          { id: 'e_1', original: 'XYZ', corrected: '改正乙', type: 'phrase', reason: '表述建议', position: 12 },
        ],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
})

async function waitForEditorAndCheck() {
  render(<QualityCheckPage />)
  // 等样例文本加载 + 编辑器可见
  await waitFor(() => {
    expect(screen.queryByText('开始校对')).toBeTruthy()
  })
  // 等 useEffect 注入 leftText（按钮 disabled → enabled）
  const btn = screen.getByText('开始校对') as HTMLButtonElement
  await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 3000 })
  fireEvent.click(btn)
  // 等错误列表渲染
  await waitFor(() => {
    expect(screen.queryByTestId('qc-error-card-e_0')).toBeTruthy()
    expect(screen.queryByTestId('qc-error-card-e_1')).toBeTruthy()
  })
}

describe('QualityCheckPage: token ↔ error卡 hover + 改正后双栏', () => {
  it('hover 原文 token → 对应错误卡添加 hovered class', async () => {
    await waitForEditorAndCheck()
    const tokens = document.querySelectorAll('.xf-editor-canvas [data-err-id]')
    expect(tokens.length).toBeGreaterThanOrEqual(1)
    const token = tokens[0] as HTMLElement
    fireEvent.mouseEnter(token)
    await waitFor(() => {
      const card = document.querySelector('[data-testid="qc-error-card-e_0"]') as HTMLElement
      expect(card.className).toContain('hovered')
    })
    fireEvent.mouseLeave(token)
    await waitFor(() => {
      const card = document.querySelector('[data-testid="qc-error-card-e_0"]') as HTMLElement
      expect(card.className).not.toContain('hovered')
    })
  })

  it('hover 错误卡 → 对应 token 添加 hovered class', async () => {
    await waitForEditorAndCheck()
    const card = screen.getByTestId('qc-error-card-e_1') as HTMLElement
    fireEvent.mouseEnter(card)
    await waitFor(() => {
      const token = document.querySelector('.xf-editor-canvas [data-err-id="e_1"]') as HTMLElement
      expect(token).toBeTruthy()
      expect(token.className).toContain('hovered')
    })
    fireEvent.mouseLeave(card)
    await waitFor(() => {
      const token = document.querySelector('.xf-editor-canvas [data-err-id="e_1"]') as HTMLElement
      expect(token.className).not.toContain('hovered')
    })
  })

  it('改正后双栏存在 + 内容非空', async () => {
    await waitForEditorAndCheck()
    expect(screen.queryByTestId('qc-corrected-pane')).toBeTruthy()
    expect(screen.queryByTestId('qc-corrected-text')).toBeTruthy()
    expect(screen.getByTestId('qc-corrected-text').textContent).toMatch(/改正甲|改正乙/)
  })
})
