// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { PRIMITIVES, primitivesToCSSVars, SCALE_NAMES } from '../../src/design/primitives'

describe('primitives', () => {
  it('exports 10+ color scales (slate, blue, purple, indigo, red, green, amber, cyan, magenta, orange)', () => {
    expect(SCALE_NAMES.length).toBeGreaterThanOrEqual(10)
    expect(SCALE_NAMES).toContain('slate')
    expect(SCALE_NAMES).toContain('blue')
  })

  it('each scale has exactly 12 steps (Radix-style)', () => {
    for (const name of SCALE_NAMES) {
      expect(PRIMITIVES[name]).toHaveLength(12)
    }
  })

  it('brand blue-7 equals #1677ff (the canonical Ant Blue)', () => {
    expect(PRIMITIVES.blue[6]).toBe('#1677ff')
  })

  it('slate steps are monotonically darker as index decreases (1=lightest, 12=darkest)', () => {
    // lightness proxy: hex luminance increases with index
    const lum = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const slate = PRIMITIVES.slate
    for (let i = 1; i < slate.length; i++) {
      expect(lum(slate[i])).toBeLessThan(lum(slate[i - 1]))
    }
  })

  it('primitivesToCSSVars() emits kebab-case CSS variable names', () => {
    const css = primitivesToCSSVars()
    expect(css).toMatch(/--blue-7:\s*#1677ff/)
    expect(css).toMatch(/--slate-12:\s*#[0-9a-f]{6}/)
    // No camelCase leakage
    expect(css).not.toMatch(/--[A-Z]/)
  })
})
