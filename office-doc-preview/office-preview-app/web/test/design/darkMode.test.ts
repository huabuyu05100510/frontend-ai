// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { DARK_OVERRIDES, darkToCSSVars } from '../../src/design/semantic'

describe('dark mode overrides', () => {
  it('exports dark overrides for text and bg tokens', () => {
    expect(DARK_OVERRIDES['color-text']).toBe('var(--slate-1)')
    expect(DARK_OVERRIDES['color-bg']).toBe('var(--slate-12)')
    expect(DARK_OVERRIDES['color-bg-canvas']).toBe('var(--slate-11)')
  })

  it('darkToCSSVars wraps declarations in :root[data-theme="dark"]', () => {
    const css = darkToCSSVars()
    expect(css).toMatch(/:root\[data-theme="dark"\]/)
    expect(css).toMatch(/--color-text:\s*var\(--slate-1\)/)
    expect(css).toMatch(/--color-bg:\s*var\(--slate-12\)/)
  })

  it('status colors get lighter variants in dark mode for contrast', () => {
    expect(DARK_OVERRIDES['color-success']).toBe('var(--green-5)')
    expect(DARK_OVERRIDES['color-warning']).toBe('var(--amber-5)')
    expect(DARK_OVERRIDES['color-danger']).toBe('var(--red-5)')
  })
})
