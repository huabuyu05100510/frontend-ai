// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { primitivesToCSSVars } from '../../src/design/primitives'

describe('primitives are consumable', () => {
  it('primitivesToCSSVars() returns a non-empty string usable in CSS', () => {
    const css = primitivesToCSSVars()
    expect(css.length).toBeGreaterThan(1000)  // 10 scales * 12 steps ~= substantial
    expect(css).toContain('--blue-7')
  })

  it('every CSS var name follows --{scale}-{1..12} pattern', () => {
    const css = primitivesToCSSVars()
    const matches = css.match(/--[a-z]+-\d+:/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(120)  // 10 scales * 12 steps
    expect(matches.every(m => /^--[a-z]+-(?:[1-9]|1[0-2]):$/.test(m))).toBe(true)
  })
})
