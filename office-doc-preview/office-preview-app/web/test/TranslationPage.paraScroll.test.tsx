// TranslationPage: 段落模式 hover 同步滚动 + 双向高亮
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TranslationPage } from '../src/pages/TranslationPage'
import { useStore } from '../src/store'

beforeEach(() => {
  vi.restoreAllMocks()
  useStore.setState({ tasks: [], fetchTasks: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
    const u = url.startsWith('http') ? url : 'http://test' + url
    const p = new URL(u).pathname
    const method = (init?.method || 'GET').toUpperCase()
    if (p === '/api/translate/realtime' && method === 'POST') {
      return new Response(JSON.stringify({
        engine: 'mock',
        ms: 5,
        target: 'Today we discuss project progress.\nNext topic is budget.\nPlease speak actively.',
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/translate/align' && method === 'POST') {
      return new Response(JSON.stringify({
        srcTokens: ['今天', '我们', '讨论', '项目', '进度。'],
        tgtTokens: ['Today', 'we', 'discuss', 'project', 'progress.'],
        pairs: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
})

describe('TranslationPage 段落模式: hover 同步滚动', () => {
  it('hover src 段落 → 对应 tgt 段 scrollIntoView 被调用', async () => {
    render(<TranslationPage />)
    const scrollSpy = vi.fn()
    const origScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy as any

    fireEvent.click(screen.getByText('实时翻译'))
    fireEvent.click(screen.getByTestId('rt-view-mode-paragraph'))
    await waitFor(() => expect(screen.queryByTestId('rt-para-pane')).toBeTruthy())

    const ta = screen.getByPlaceholderText(/开始输入/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '今天我们讨论项目进度。\n下一议题是预算分配。\n请大家积极发言。' } })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="rt-para-tgt-"]').length).toBeGreaterThanOrEqual(2)
    }, { timeout: 2000 })

    const srcSegs = document.querySelectorAll('[data-testid^="rt-para-src-"]')
    expect(srcSegs.length).toBeGreaterThanOrEqual(2)

    scrollSpy.mockClear()
    fireEvent.mouseEnter(srcSegs[1])

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    }, { timeout: 2000 })

    HTMLElement.prototype.scrollIntoView = origScrollIntoView
  })

  it('hover tgt 段落 → 对应 src 段 scrollIntoView 被调用', async () => {
    render(<TranslationPage />)
    // 全局 spy 所有 scrollIntoView（覆盖 React re-render 替换元素的情况）
    const scrollSpy = vi.fn()
    const origScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy as any

    fireEvent.click(screen.getByText('实时翻译'))
    fireEvent.click(screen.getByTestId('rt-view-mode-paragraph'))
    await waitFor(() => expect(screen.queryByTestId('rt-para-pane')).toBeTruthy())

    const ta = screen.getByPlaceholderText(/开始输入/) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '今天我们讨论项目进度。\n下一议题是预算分配。\n请大家积极发言。' } })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="rt-para-tgt-"]').length).toBeGreaterThanOrEqual(2)
    }, { timeout: 2000 })

    // 重置 spy（避免之前 setHoveredSrcPara → src hover 触发滚动也被计数）
    scrollSpy.mockClear()

    const tgtSegs = document.querySelectorAll('[data-testid^="rt-para-tgt-"]')
    // tgtSegs[0] 是 column，tgtSegs[1..] 才是 paragraphs
    fireEvent.mouseEnter(tgtSegs[1])

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    }, { timeout: 2000 })

    HTMLElement.prototype.scrollIntoView = origScrollIntoView
  })
})