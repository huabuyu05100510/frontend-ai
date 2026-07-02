// TranslationPage 前后对比 + hover 高亮联动 测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TranslationPage } from '../src/pages/TranslationPage'
import { useStore } from '../src/store'

function makeFetchOk(json: any) {
  return vi.spyOn(global, 'fetch').mockImplementation((async () => {
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
}

beforeEach(() => {
  vi.restoreAllMocks()
  useStore.setState({
    tasks: [{
      id: 't_doc1', name: 'doc.pdf', ext: 'pdf', status: 'ready',
      originalUrl: '/api/files/t_doc1?as=original',
    } as any],
    fetchTasks: vi.fn().mockResolvedValue(undefined),
  })
})

describe('TranslationPage TextTranslateMode: 前后对比 + hover 联动', () => {
  it('翻译结果左右两栏显示，hover 一栏另一栏高亮', async () => {
    makeFetchOk({
      sourceLang: 'zh-CN', targetLang: 'en',
      segments: [
        { index: 0, source: '第一段', target: 'First paragraph' },
        { index: 1, source: '第二段', target: 'Second paragraph' },
      ],
      meta: { engine: 'mock', targetChars: 30, pagesCount: 0, segmentsCount: 2, sourceChars: 8 },
      ms: 12,
    })
    render(<TranslationPage />)
    fireEvent.click(screen.getByText('文本翻译'))
    fireEvent.change(screen.getByPlaceholderText(/输入要翻译的文本/), { target: { value: '第一段\n第二段' } })
    fireEvent.click(screen.getByText(/^翻译$/))
    await waitFor(() => expect(screen.getByTestId('text-compare-result')).toBeTruthy())
    expect(screen.getByTestId('text-compare-row-0')).toBeTruthy()
    expect(screen.getByTestId('text-compare-row-1')).toBeTruthy()
    // hover 第一段
    fireEvent.mouseEnter(screen.getByTestId('text-compare-row-0'))
    await waitFor(() => {
      const row = screen.getByTestId('text-compare-row-0') as HTMLElement
      expect(row.style.background).toBe('var(--color-warning-bg)')  // #fff7e6
      const src = screen.getByTestId('text-compare-src-0') as HTMLElement
      expect(src.style.borderLeft).toContain('var(--color-warning)')  // #faad14
    })
    // mouse leave 后应恢复
    fireEvent.mouseLeave(screen.getByTestId('text-compare-row-0'))
    await waitFor(() => {
      const row = screen.getByTestId('text-compare-row-0') as HTMLElement
      expect(row.style.background).toBe('transparent')
    })
  })
})

describe('TranslationPage RealtimeTranslateMode: 段落对照模式', () => {
  it('切换到段落模式显示 src/tgt 双栏，hover 联动', async () => {
    // mock 实时翻译 + align
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
      const u = url.startsWith('http') ? url : 'http://test' + url
      const p = new URL(u).pathname
      const method = (init?.method || 'GET').toUpperCase()
      if (p === '/api/translate/realtime' && method === 'POST') {
        return new Response(JSON.stringify({
          target: 'First para\nSecond para',
          engine: 'mock', ms: 1,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (p === '/api/translate/align' && method === 'POST') {
        return new Response(JSON.stringify({
          srcTokens: ['First\n', 'para'],
          tgtTokens: ['第一段', '第二段'],
          pairs: [[0, 0], [1, 1]],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 200 })
    }) as any)
    render(<TranslationPage />)
    // 默认进入 text 模式 → 切到 realtime
    fireEvent.click(screen.getByText('实时翻译'))
    expect(screen.getByTestId('rt-view-mode-word')).toBeTruthy()
    // 切换到段落模式
    fireEvent.click(screen.getByTestId('rt-view-mode-paragraph'))
    // 段落面板应出现
    await waitFor(() => {
      expect(screen.getByTestId('rt-para-pane')).toBeTruthy()
      expect(screen.getByTestId('rt-para-src-col')).toBeTruthy()
      expect(screen.getByTestId('rt-para-tgt-col')).toBeTruthy()
    })
  })
})
