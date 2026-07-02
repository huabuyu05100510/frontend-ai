// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePalette } from '../../src/palette/usePalette'

describe('usePalette', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    // Cleanup any leftover keydown listeners
  })

  it('initial state is closed', () => {
    const { result } = renderHook(() => usePalette())
    expect(result.current.isOpen).toBe(false)
  })

  it('open() sets isOpen true', () => {
    const { result } = renderHook(() => usePalette())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
  })

  it('close() sets isOpen false', () => {
    const { result } = renderHook(() => usePalette())
    act(() => result.current.open())
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
  })

  it('toggle() flips state', () => {
    const { result } = renderHook(() => usePalette())
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(false)
  })

  it('Cmd+K (metaKey) opens palette', () => {
    const { result } = renderHook(() => usePalette())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('Ctrl+K (ctrlKey) opens palette', () => {
    const { result } = renderHook(() => usePalette())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('Esc closes palette when open', () => {
    const { result } = renderHook(() => usePalette())
    act(() => result.current.open())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(result.current.isOpen).toBe(false)
  })
})