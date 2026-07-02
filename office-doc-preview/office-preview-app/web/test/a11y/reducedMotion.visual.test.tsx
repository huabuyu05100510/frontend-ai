// 模型：claude-sonnet-4-6
// Vitest test that asserts CSS rule presence; Playwright emulation happens in CI
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('reducedMotion CSS guard', () => {
  const cssPath = join(__dirname, '../../src/a11y/reducedMotion.css')
  const css = readFileSync(cssPath, 'utf8')

  it('declares @media (prefers-reduced-motion: reduce) guard', () => {
    expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('targets :root[data-motion="off"] for JS-driven override', () => {
    expect(css).toMatch(/:root\[data-motion="off"\]/)
  })

  it('overrides animation-duration and transition-duration', () => {
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/)
  })

  it('disables scroll-behavior auto (prevents smooth scroll)', () => {
    expect(css).toMatch(/scroll-behavior:\s*auto\s*!important/)
  })
})
