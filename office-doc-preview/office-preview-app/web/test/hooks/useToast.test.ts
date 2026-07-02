// 模型：claude-sonnet-4-6
// useToast — Toast 状态管理 hook 测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToastStore } from '../../src/hooks/useToast'

describe('useToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 重置 store
    useToastStore.getState().clear()
  })
  afterEach(() => {
    act(() => {
      useToastStore.getState().clear()
    })
    vi.useRealTimers()
  })

  it('push adds an id to the queue', () => {
    const { result } = renderHook(() => useToastStore())
    act(() => {
      result.current.push({ kind: 'info', message: 'hello' })
    })
    expect(result.current.queue.length).toBe(1)
    expect(result.current.queue[0].id).toBeTruthy()
    expect(result.current.queue[0].message).toBe('hello')
    expect(result.current.queue[0].kind).toBe('info')
  })

  it('dismiss removes by id', () => {
    const { result } = renderHook(() => useToastStore())
    act(() => {
      result.current.push({ kind: 'success', message: 'one' })
      result.current.push({ kind: 'error', message: 'two' })
    })
    expect(result.current.queue.length).toBe(2)
    const target = result.current.queue[0].id
    act(() => {
      result.current.dismiss(target)
    })
    expect(result.current.queue.length).toBe(1)
    expect(result.current.queue[0].message).toBe('two')
  })

  it('clear empties the queue', () => {
    const { result } = renderHook(() => useToastStore())
    act(() => {
      result.current.push({ kind: 'info', message: 'a' })
      result.current.push({ kind: 'info', message: 'b' })
      result.current.push({ kind: 'info', message: 'c' })
    })
    expect(result.current.queue.length).toBe(3)
    act(() => {
      result.current.clear()
    })
    expect(result.current.queue.length).toBe(0)
  })

  it('auto-dismisses after durationMs (default 4000ms)', () => {
    const { result } = renderHook(() => useToastStore())
    act(() => {
      result.current.push({ kind: 'info', message: 'auto', durationMs: 1000 })
    })
    expect(result.current.queue.length).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.queue.length).toBe(0)
  })

  it('default durationMs is 4000ms', () => {
    const { result } = renderHook(() => useToastStore())
    act(() => {
      result.current.push({ kind: 'info', message: 'default' })
    })
    const item = result.current.queue[0]
    expect(item.durationMs).toBe(4000)
    // 不到 4000ms 不消失
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(result.current.queue.length).toBe(1)
    // 到 4000ms 消失
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.queue.length).toBe(0)
  })

  it('custom durationMs overrides default', () => {
    const { result } = renderHook(() => useToastStore())
    act(() => {
      result.current.push({ kind: 'info', message: 'short', durationMs: 200 })
    })
    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current.queue.length).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.queue.length).toBe(0)
  })
})