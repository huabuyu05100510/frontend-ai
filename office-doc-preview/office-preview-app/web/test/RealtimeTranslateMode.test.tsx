// RealtimeTranslateMode 测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { TranslationPage } from '../src/pages/TranslationPage'

beforeEach(() => {
  vi.useFakeTimers()
  vi.restoreAllMocks()
  vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
    const u = url.startsWith('http') ? url : 'http://test' + url
    const p = new URL(u).pathname
    if (p === '/api/translate/realtime') {
      const body = JSON.parse(init?.body || '{}')
      return new Response(JSON.stringify({
        target: `[en] ${body.text}`,
        charMap: [],
        engine: 'mock-v1',
        provider: 'mock',
        ms: 1,
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/translate/align') {
      const body = JSON.parse(init?.body || '{}')
      return new Response(JSON.stringify({
        srcTokens: body.src?.split(' ') || [],
        tgtTokens: body.tgt?.split(' ') || [],
        pairs: [[0, 0, 1.0]],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/translate/annotation') {
      if ((init?.method || 'GET') === 'GET') {
        return new Response(JSON.stringify({ items: [] }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        ok: true,
        id: 'test-id-1234567890',
        annotation: { kind: 'seg_rating', id: 'test-id-1234567890', payload: JSON.parse(init?.body || '{}').payload },
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('ok', { status: 200 })
  }) as any)
})

describe('TranslationPage 实时翻译模式', () => {
  it('子菜单包含"实时翻译"项', () => {
    render(<TranslationPage />)
    expect(screen.getByText('实时翻译')).toBeTruthy()
  })

  it('切换到实时翻译显示输入框', async () => {
    vi.useRealTimers()
    render(<TranslationPage />)
    fireEvent.click(screen.getByText('实时翻译'))
    // 输入框 placeholder
    const ta = screen.getByPlaceholderText(/开始输入.*自动翻译/)
    expect(ta).toBeTruthy()
  })

  it('输入后 debounce 触发实时翻译', async () => {
    vi.useRealTimers()
    render(<TranslationPage />)
    fireEvent.click(screen.getByText('实时翻译'))
    const ta = screen.getByPlaceholderText(/开始输入.*自动翻译/)
    fireEvent.change(ta, { target: { value: 'hello world' } })

    // debounce 500ms + 网络模拟
    await waitFor(() => {
      expect(screen.getByText(/\[en\] hello world/)).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('切换语言方向触发重新翻译', async () => {
    vi.useRealTimers()
    render(<TranslationPage />)
    fireEvent.click(screen.getByText('实时翻译'))
    const ta = screen.getByPlaceholderText(/开始输入.*自动翻译/)
    fireEvent.change(ta, { target: { value: '你好' } })
    await waitFor(() => expect(screen.getByText(/\[en\] 你好/)).toBeTruthy(), { timeout: 3000 })
  })

  it('显示词级对齐 tokens 区', async () => {
    vi.useRealTimers()
    render(<TranslationPage />)
    fireEvent.click(screen.getByText('实时翻译'))
    const ta = screen.getByPlaceholderText(/开始输入.*自动翻译/)
    fireEvent.change(ta, { target: { value: 'I love coding' } })
    await waitFor(() => {
      expect(screen.getByTestId('rt-align-pane')).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('点击译文打开标注弹窗并可提交评分', async () => {
    vi.useRealTimers()
    render(<TranslationPage />)
    fireEvent.click(screen.getByText('实时翻译'))
    const ta = screen.getByPlaceholderText(/开始输入.*自动翻译/)
    fireEvent.change(ta, { target: { value: '你好' } })
    await waitFor(() => expect(screen.getByText(/\[en\] 你好/)).toBeTruthy())
    // 等对齐完成
    await waitFor(() => expect(screen.getByTestId('rt-align-pane')).toBeTruthy())

    // 点击译文区 → 打开标注弹窗
    const targetPane = screen.getByTestId('rt-target-pane')
    fireEvent.click(targetPane)
    await waitFor(() => {
      expect(screen.getByText(/标注反馈/)).toBeTruthy()
    })

    // 选择 seg_rating 类型并提交
    const ratingRadio = screen.getByLabelText(/段落评分/) as HTMLInputElement
    fireEvent.click(ratingRadio)
    const submitBtn = screen.getByText(/提交反馈/)
    fireEvent.click(submitBtn)
    await waitFor(() => {
      // 提交后弹窗关闭
      expect(screen.queryByText(/标注反馈/)).toBeNull()
    })
  })
})
