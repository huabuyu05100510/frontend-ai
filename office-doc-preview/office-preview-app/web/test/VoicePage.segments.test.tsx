// VoicePage: ASR 分段 + per-segment 翻译 + 音频时间轴 hover 联动
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VoicePage } from '../src/pages/VoicePage'
import { useStore } from '../src/store'

beforeEach(() => {
  vi.restoreAllMocks()
  useStore.setState({
    tasks: [{
      id: 't_audio1', name: 'lecture.mp3', ext: 'mp3', status: 'ready',
      originalUrl: '/api/files/t_audio1?as=original',
    } as any],
    fetchTasks: vi.fn().mockResolvedValue(undefined),
  })
  vi.spyOn(global, 'fetch').mockImplementation((async (url: string, init?: any) => {
    const u = url.startsWith('http') ? url : 'http://test' + url
    const p = new URL(u).pathname
    const method = (init?.method || 'GET').toUpperCase()
    if (p === '/api/tasks' && method === 'GET') {
      return new Response(JSON.stringify({
        tasks: [{ id: 't_audio1', name: 'lecture.mp3', ext: 'mp3', status: 'ready', originalUrl: '/api/files/t_audio1?as=original' }],
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (p === '/api/speech/asr-segments' && method === 'POST') {
      return new Response(JSON.stringify({
        segments: [
          { start_ms: 0,    end_ms: 3000, source: '今天我们讨论项目', target: '[en] Today we discuss the project' },
          { start_ms: 3000, end_ms: 6000, source: '下一议题是预算', target: '[en] Next topic is budget' },
          { start_ms: 6000, end_ms: 9000, source: '请大家积极发言', target: '[en] Please speak actively' },
        ],
        fullText: '今天我们讨论项目。下一议题是预算。请大家积极发言。',
        fullTranslation: '[en] ...',
        engine: 'mock',
        ms: 12,
        segmentsCount: 3,
      }) as any, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any)
})

async function goToAudioSegments() {
  render(<VoicePage />)
  // 切到 audio 子模式
  fireEvent.click(screen.getByText('音频翻译'))
  // 等文件列表渲染
  await waitFor(() => expect(screen.getByText('lecture.mp3')).toBeTruthy())
  fireEvent.click(screen.getByText('lecture.mp3'))
  // 触发 ASR — 用 role 限定 button
  const allBtns = await screen.findAllByRole('button')
  const btn = allBtns.find(b => /ASR\s*\+\s*翻译|开始识别/.test(b.textContent || ''))
  expect(btn).toBeTruthy()
  fireEvent.click(btn as HTMLElement)
  await waitFor(() => expect(screen.queryByTestId('voice-segment-0')).toBeTruthy())
}

describe('VoicePage: ASR 分段 + 音频时间轴 hover 联动', () => {
  it('ASR 后展示多段 segment + per-segment 翻译', async () => {
    await goToAudioSegments()
    expect(screen.queryAllByTestId(/^voice-segment-\d+$/).length).toBe(3)
    expect(screen.getByTestId('voice-segment-0').textContent).toContain('今天我们讨论项目')
    expect(screen.getByTestId('voice-segment-0').textContent).toContain('Today we discuss')
  })

  it('hover segment 触发 audio.currentTime 跳转到 start_ms', async () => {
    await goToAudioSegments()
    // mock audioRef: spy on audio element's currentTime setter
    const audio = document.querySelector('audio[data-testid="voice-audio"]') as HTMLAudioElement
    expect(audio).toBeTruthy()
    const ctSpy = vi.fn()
    Object.defineProperty(audio, 'currentTime', { set: ctSpy, get: () => 0, configurable: true })

    fireEvent.mouseEnter(screen.getByTestId('voice-segment-1'))
    await waitFor(() => {
      // start_ms = 3000 → currentTime = 3.0
      expect(ctSpy).toHaveBeenCalledWith(3.0)
    })
    fireEvent.mouseEnter(screen.getByTestId('voice-segment-2'))
    await waitFor(() => {
      expect(ctSpy).toHaveBeenCalledWith(6.0)
    })
  })

  it('audio timeupdate 事件 → 激活对应 segment（activeSegmentId）', async () => {
    await goToAudioSegments()
    const audio = document.querySelector('audio[data-testid="voice-audio"]') as HTMLAudioElement
    expect(audio).toBeTruthy()
    // 触发 timeupdate 在 segment 2 区间 (3s ≤ t < 6s)
    Object.defineProperty(audio, 'currentTime', { value: 4.5, configurable: true, writable: true })
    audio.dispatchEvent(new Event('timeupdate'))
    await waitFor(() => {
      const seg = screen.getByTestId('voice-segment-1') as HTMLElement
      expect(seg.className).toContain('active')
    })
  })

  it('audio 元素存在 + controls', async () => {
    await goToAudioSegments()
    const audio = document.querySelector('audio[data-testid="voice-audio"]') as HTMLAudioElement
    expect(audio).toBeTruthy()
    expect(audio.controls).toBe(true)
  })
})
