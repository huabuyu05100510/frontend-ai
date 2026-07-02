// 模型：claude-sonnet-4-6
// Bookmarks slice tests — Set<string> persisted to localStorage
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStore } from '../../src/store'

describe('store.bookmarks slice', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset the slice state between tests
    useStore.setState({ bookmarks: new Set() } as any)
  })

  it('toggleBookmark adds a taskId to the bookmarks set', () => {
    const { result } = renderHook(() => useStore(s => s))
    act(() => {
      result.current.toggleBookmark('task-1')
    })
    expect(result.current.isBookmarked('task-1')).toBe(true)
  })

  it('toggleBookmark removes a taskId on second toggle', () => {
    const { result } = renderHook(() => useStore(s => s))
    act(() => {
      result.current.toggleBookmark('task-2')
    })
    expect(result.current.isBookmarked('task-2')).toBe(true)
    act(() => {
      result.current.toggleBookmark('task-2')
    })
    expect(result.current.isBookmarked('task-2')).toBe(false)
  })

  it('bookmarks persist to localStorage and rehydrate on next read', () => {
    const { result } = renderHook(() => useStore(s => s))
    act(() => {
      result.current.toggleBookmark('task-3')
    })
    // localStorage should have an entry
    const raw = localStorage.getItem('bookmarks')
    expect(raw).toBeTruthy()
    const arr = JSON.parse(raw!)
    expect(arr).toContain('task-3')

    // Simulate rehydrate by reading from storage and re-seeding state
    const rehydrated = new Set(arr)
    useStore.setState({ bookmarks: rehydrated } as any)
    expect(useStore.getState().isBookmarked('task-3')).toBe(true)
  })
})