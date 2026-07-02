// VoicePage: 可见的音频时间轴 + 段标记 + 跳转联动
// 模型：claude-sonnet-4-6
//
// 可视化时间轴让用户一眼看到音频分段结构，点击标记跳转 + hover 高亮段卡。
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
  fireEvent.click(screen.getByText('音频翻译'))
  await waitFor(() => expect(screen.getByText('lecture.mp3')).toBeTruthy())
  fireEvent.click(screen.getByText('lecture.mp3'))
  const allBtns = await screen.findAllByRole('button')
  const btn = allBtns.find(b => /ASR\s*\+\s*翻译|开始识别/.test(b.textContent || ''))
  expect(btn).toBeTruthy()
  fireEvent.click(btn as HTMLElement)
  await waitFor(() => expect(screen.queryByTestId('voice-segment-0')).toBeTruthy())
}

describe('VoicePage: 可视化时间轴（timeline）', () => {
  it('ASR 后渲染时间轴容器 + 每个段一个标记（voice-timeline-marker-i）', async () => {
    await goToAudioSegments()
    const timeline = screen.getByTestId('voice-timeline')
    expect(timeline).toBeTruthy()
    expect(screen.queryAllByTestId(/^voice-timeline-marker-\d+$/).length).toBe(3)
  })

  it('每个 marker 有正确的 left% 和 width% （按时间比例）', async () => {
    await goToAudioSegments()
    // 总时长 9000ms；3 段各 3000ms → 每段 width 约 33.33%，left 0/33.33/66.66
    const m0 = screen.getByTestId('voice-timeline-marker-0') as HTMLElement
    const m1 = screen.getByTestId('voice-timeline-marker-1') as HTMLElement
    expect(m0.style.left).toBe('0%')
    expect(parseFloat(m0.style.width)).toBeCloseTo(33.333, 1)
    expect(parseFloat(m1.style.left)).toBeCloseTo(33.333, 1)
  })

  it('marker 内显示 source 文本 + 时间标签在 timeline 头部', async () => {
    await goToAudioSegments()
    const m0 = screen.getByTestId('voice-timeline-marker-0') as HTMLElement
    expect(m0.textContent).toContain('今天我们讨论项目')
    const timeline = screen.getByTestId('voice-timeline')
    expect(timeline.textContent).toContain('00:00')
  })

  it('点击 marker → audio.currentTime 跳到 start_ms/1000', async () => {
    await goToAudioSegments()
    const audio = document.querySelector('audio[data-testid="voice-audio"]') as HTMLAudioElement
    const ctSpy = vi.fn()
    Object.defineProperty(audio, 'currentTime', { set: ctSpy, get: () => 0, configurable: true })

    fireEvent.click(screen.getByTestId('voice-timeline-marker-2'))
    await waitFor(() => expect(ctSpy).toHaveBeenCalledWith(6.0))
  })

  it('hover marker → 对应段卡同时高亮（hovered class）', async () => {
    await goToAudioSegments()
    fireEvent.mouseEnter(screen.getByTestId('voice-timeline-marker-1'))
    await waitFor(() => {
      const seg1 = screen.getByTestId('voice-segment-1') as HTMLElement
      expect(seg1.className).toContain('hovered')
    })
  })

  it('timeupdate → activeSegIdx 在 timeline 上反映（active class）', async () => {
    await goToAudioSegments()
    const audio = document.querySelector('audio[data-testid="voice-audio"]') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { value: 4.5, configurable: true, writable: true })
    audio.dispatchEvent(new Event('timeupdate'))
    await waitFor(() => {
      const m1 = screen.getByTestId('voice-timeline-marker-1') as HTMLElement
      expect(m1.className).toContain('active')
    })
  })

  it('timeline 显示总时长标签 (mm:ss)', async () => {
    await goToAudioSegments()
    const timeline = screen.getByTestId('voice-timeline')
    // 9 秒 → "00:09"
    expect(timeline.textContent).toContain('00:09')
  })
})