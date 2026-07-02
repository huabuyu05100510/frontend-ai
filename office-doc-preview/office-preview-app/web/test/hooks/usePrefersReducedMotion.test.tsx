import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePrefersReducedMotion } from '../../src/hooks/usePrefersReducedMotion'

// Mock matchMedia since jsdom doesn't implement it
const mockMatchMedia = (matches: boolean) => {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((_evt: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb)
    }),
    removeEventListener: vi.fn((_evt: string, cb: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql)
  return { mql, listeners }
}

describe('usePrefersReducedMotion', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    document.documentElement.removeAttribute('data-motion')
    originalMatchMedia = window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('returns false when no reduced-motion preference', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
    expect(document.documentElement.getAttribute('data-motion')).toBe('on')
  })

  it('returns true when prefers-reduced-motion: reduce', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
    expect(document.documentElement.getAttribute('data-motion')).toBe('off')
  })

  it('updates <html data-motion> when media query changes', () => {
    const { mql, listeners } = mockMatchMedia(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)

    act(() => {
      mql.matches = true
      listeners.forEach(l => l({ matches: true } as MediaQueryListEvent))
    })
    expect(result.current).toBe(true)
    expect(document.documentElement.getAttribute('data-motion')).toBe('off')
  })
})
