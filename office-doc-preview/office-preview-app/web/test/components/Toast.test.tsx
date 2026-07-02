// 模型：claude-sonnet-4-6
// Toast — 通知堆叠容器组件测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Toast } from '../../src/components/Toast'
import { useToastStore } from '../../src/hooks/useToast'
import type { ToastItem } from '../../src/hooks/useToast'

function makeItem(overrides: Partial<ToastItem> = {}): ToastItem {
  return {
    id: `t_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'info',
    message: 'hello',
    durationMs: 4000,
    ...overrides,
  }
}

describe('Toast container', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-motion')
    useToastStore.getState().clear()
  })
  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-motion')
    useToastStore.getState().clear()
  })

  it('renders a queue of 3 toasts', () => {
    const queue: ToastItem[] = [
      makeItem({ id: 'a', kind: 'success', message: 'A 保存成功' }),
      makeItem({ id: 'b', kind: 'error', message: 'B 出错了' }),
      makeItem({ id: 'c', kind: 'info', message: 'C 提示' }),
    ]
    const onDismiss = vi.fn()
    render(<Toast queue={queue} onDismiss={onDismiss} />)
    expect(screen.getByTestId('oa-toast-container')).toBeTruthy()
    expect(screen.getByTestId('oa-toast-a')).toBeTruthy()
    expect(screen.getByTestId('oa-toast-b')).toBeTruthy()
    expect(screen.getByTestId('oa-toast-c')).toBeTruthy()
    expect(screen.getByText('A 保存成功')).toBeTruthy()
  })

  it('applies per-kind modifier class', () => {
    const queue: ToastItem[] = [
      makeItem({ id: 's', kind: 'success', message: 'ok' }),
      makeItem({ id: 'e', kind: 'error', message: 'err' }),
      makeItem({ id: 'i', kind: 'info', message: 'i' }),
      makeItem({ id: 'w', kind: 'warning', message: 'w' }),
    ]
    render(<Toast queue={queue} onDismiss={() => {}} />)
    expect(screen.getByTestId('oa-toast-s').className).toContain('oa-toast-success')
    expect(screen.getByTestId('oa-toast-e').className).toContain('oa-toast-error')
    expect(screen.getByTestId('oa-toast-i').className).toContain('oa-toast-info')
    expect(screen.getByTestId('oa-toast-w').className).toContain('oa-toast-warning')
  })

  it('auto-dismisses after durationMs (via useToastStore integration)', () => {
    vi.useFakeTimers()
    try {
      // 用真实 store push 一次，看 store 内部是否会移除（并模拟外部 queue 同步）
      const id = useToastStore.getState().push({ kind: 'info', message: 'auto', durationMs: 1500 })
      expect(useToastStore.getState().queue.length).toBe(1)
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(useToastStore.getState().queue.length).toBe(0)
      expect(useToastStore.getState().queue.find(t => t.id === id)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hovering sets data-paused="true"; unhover sets data-paused="false"', () => {
    const queue = [makeItem({ id: 'h', kind: 'info', message: 'h', durationMs: 1000 })]
    render(<Toast queue={queue} onDismiss={() => {}} />)
    const toast = screen.getByTestId('oa-toast-h')
    expect(toast.getAttribute('data-paused')).toBe('false')
    fireEvent.mouseEnter(toast)
    expect(toast.getAttribute('data-paused')).toBe('true')
    fireEvent.mouseLeave(toast)
    expect(toast.getAttribute('data-paused')).toBe('false')
  })

  it('Esc closes all visible toasts', () => {
    const onDismiss = vi.fn()
    const queue: ToastItem[] = [
      makeItem({ id: 'a', kind: 'info', message: 'A' }),
      makeItem({ id: 'b', kind: 'info', message: 'B' }),
    ]
    render(<Toast queue={queue} onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledWith('a')
    expect(onDismiss).toHaveBeenCalledWith('b')
  })

  it('dismiss button removes a single toast', () => {
    const onDismiss = vi.fn()
    const queue: ToastItem[] = [
      makeItem({ id: 'x', kind: 'info', message: 'X' }),
      makeItem({ id: 'y', kind: 'info', message: 'Y' }),
    ]
    render(<Toast queue={queue} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByTestId('oa-toast-x-dismiss'))
    expect(onDismiss).toHaveBeenCalledWith('x')
    expect(onDismiss).not.toHaveBeenCalledWith('y')
  })

  it('respects reduced-motion via data-motion="off"', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    const queue = [makeItem({ id: 'rm', kind: 'info', message: 'rm' })]
    const { container } = render(<Toast queue={queue} onDismiss={() => {}} />)
    expect(container.querySelector('[data-projection-id]')).toBeNull()
    expect(screen.getByTestId('oa-toast-rm')).toBeTruthy()
  })

  it('sets role="alert" on each toast for a11y', () => {
    const queue = [makeItem({ id: 'a11y', kind: 'error', message: 'fail' })]
    render(<Toast queue={queue} onDismiss={() => {}} />)
    const toast = screen.getByTestId('oa-toast-a11y')
    expect(toast.getAttribute('role')).toBe('alert')
  })

  it('renders nothing when queue is empty', () => {
    const { container } = render(<Toast queue={[]} onDismiss={() => {}} />)
    expect(container.querySelector('[data-testid="oa-toast-container"]')).toBeNull()
  })
})