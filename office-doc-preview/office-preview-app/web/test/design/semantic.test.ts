// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { SEMANTIC_ALIASES, semanticToCSSVars, SEMANTIC_KEYS } from '../../src/design/semantic'

describe('semantic aliases', () => {
  it('exports at least 30 semantic aliases covering color/text/bg/border/status', () => {
    expect(SEMANTIC_KEYS.length).toBeGreaterThanOrEqual(30)
    expect(SEMANTIC_KEYS).toContain('color-primary')
    expect(SEMANTIC_KEYS).toContain('color-bg-canvas')
    expect(SEMANTIC_KEYS).toContain('color-text-secondary')
  })

  it('every alias resolves to a primitive var or color literal', () => {
    for (const key of SEMANTIC_KEYS) {
      // Accept: primitive refs (var(--blue-7)), composed semantic refs (var(--color-primary)),
      // hex literals (#fff), or rgba()
      expect(SEMANTIC_ALIASES[key]).toMatch(
        /^var\(--[a-z]+-\d+\)$|^var\(--color-[a-z-]+\)$|^#[0-9a-fA-F]+$|^rgba\(.+\)$/
      )
    }
  })

  it('color-primary maps to var(--blue-7) (the brand)', () => {
    expect(SEMANTIC_ALIASES['color-primary']).toBe('var(--blue-7)')
  })

  it('color-bg-canvas maps to var(--slate-3) (page background)', () => {
    expect(SEMANTIC_ALIASES['color-bg-canvas']).toBe('var(--slate-3)')
  })

  it('color-success-bg maps to var(--green-2) (subtle success background)', () => {
    expect(SEMANTIC_ALIASES['color-success-bg']).toBe('var(--green-2)')
  })

  it('semanticToCSSVars emits kebab-case CSS variable declarations', () => {
    const css = semanticToCSSVars()
    expect(css).toMatch(/--color-primary:\s*var\(--blue-7\)/)
    expect(css).toMatch(/--color-bg-canvas:\s*var\(--slate-3\)/)
    expect(css).not.toMatch(/--[A-Z]/)
  })
})
