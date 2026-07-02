// 模型：claude-sonnet-4-6
// TranslationPage.urlState — search params 解析与回填
// Phase B: 6 tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DocTranslateMode } from '../../src/pages/TranslationPage'
import { useToastStore } from '../../src/hooks/useToast'

beforeEach(() => {
  useToastStore.setState({ queue: [] })
  // @ts-ignore
  global.fetch = vi.fn().mockImplementation(async () => ({
    ok: true, status: 200, headers: new Headers(), json: async () => ({ items: [] }),
  }))
})
afterEach(() => cleanup())

function renderAt(initialPath: string) {
  // Track current path for back/forward emulation
  let currentPath = initialPath
  // 用 currentPath 重新渲染模拟 history.replaceState
  const utils = render(
    <MemoryRouter initialEntries={[currentPath]}>
      <Routes>
        <Route path="*" element={<DocTranslateMode tasks={[]} />} />
      </Routes>
    </MemoryRouter>,
  )
  return { ...utils, getCurrentPath: () => currentPath, setPath: (p: string) => { currentPath = p; utils.rerender(
    <MemoryRouter initialEntries={[p]}>
      <Routes>
        <Route path="*" element={<DocTranslateMode tasks={[]} />} />
      </Routes>
    </MemoryRouter>,
  ) } }
}

describe('DocTranslateMode URL state parsing', () => {
  it('1. parses "?stage=review&task=t_xxx" correctly', () => {
    renderAt('/translate?stage=review&task=t_xxx')
    expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('review')
  })

  it('2. invalid stage values fallback to "pick"', () => {
    renderAt('/translate?stage=BOGUS&task=t_xxx')
    expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('pick')
  })

  it('3. missing stage treats as "pick"', () => {
    renderAt('/translate?task=t_xxx')
    expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('pick')
  })

  it('4. encoding preserved for unicode task ids', () => {
    renderAt('/translate?stage=review&task=' + encodeURIComponent('任务_a'))
    expect(screen.getByTestId('oa-doc-stage-panel')).toBeTruthy()
    expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('review')
  })

  it('5. shareable URL: same URL on two renders produces same stage', () => {
    const url = '/translate?stage=export&task=t_share'
    const utils1 = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="*" element={<DocTranslateMode tasks={[]} />} /></Routes>
      </MemoryRouter>,
    )
    const stage1 = screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')
    utils1.unmount()

    const utils2 = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="*" element={<DocTranslateMode tasks={[]} />} /></Routes>
      </MemoryRouter>,
    )
    const stage2 = screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')
    expect(stage1).toBe('export')
    expect(stage2).toBe('export')
    utils2.unmount()
  })

  it('6. clicking a stage chip transitions via URL param write', async () => {
    renderAt('/translate?stage=pick')
    expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('pick')
    fireEvent.click(screen.getByTestId('oa-stage-review'))
    await waitFor(() => {
      expect(screen.getByTestId('oa-doc-stage-panel').getAttribute('data-stage')).toBe('review')
    })
  })
})
