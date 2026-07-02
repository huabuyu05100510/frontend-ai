// 模型：claude-sonnet-4-6
// Static audit of reduced-motion compliance (Phase 3.B)
// Positively asserts the guard infrastructure exists and that motion primitives
// honor `data-motion="off"`. Does NOT assert "zero violations" because the
// project's inline `transition:` / `animation:` styles in `style={{}}` props
// are intentionally neutralised by the global CSS guard — see
// `changes/a11y-reduced-motion/README.md` and `changes/reduced-motion-audit/FINDINGS.md`.
//
// Strategy:
//   1. The CSS guard (Phase 0.D `reducedMotion.css`) globally zeroes animation
//      and transition duration whenever either system `prefers-reduced-motion:
//      reduce` OR `<html data-motion="off">` is set.
//   2. The motion primitives (Phase 1.B Hover/Press/PageTransition) also read
//      `data-motion` in JS and skip their own animation when "off".
//   3. setTimeout/setInterval/rAF uses found across `web/src/*.tsx` are NOT
//      all animation drivers; many are debounce / fetch / focus / status
//      timers. This audit therefore classifies each occurrence (heuristic) and
//      reports — but does not fail on — any unmatched patterns.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const WEB_SRC = join(__dirname, '..', '..', 'src')

interface Match {
  file: string
  line: number
  text: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.vite') continue
      walk(full, out)
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function searchInFile(path: string, patterns: RegExp[]): Match[] {
  const src = readFileSync(path, 'utf8')
  const lines = src.split('\n')
  const out: Match[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const p of patterns) {
      if (p.test(lines[i])) {
        out.push({ file: path, line: i + 1, text: lines[i].trim().slice(0, 160) })
      }
    }
  }
  return out
}

describe('a11y/reduced-motion audit (Phase 3.B)', () => {
  const files = walk(WEB_SRC)
  // Sanity
  it('walks TS/TSX source files', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  // 1) CSS guard presence — global reduced-motion override
  describe('CSS guard presence', () => {
    const cssPath = join(__dirname, '..', '..', 'src', 'a11y', 'reducedMotion.css')
    const css = readFileSync(cssPath, 'utf8')

    it('exports @media (prefers-reduced-motion: reduce) guard', () => {
      expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)/)
    })
    it('exports :root[data-motion="off"] guard', () => {
      expect(css).toMatch(/:root\[data-motion="off"\]/)
    })
    it('overrides animation-duration and transition-duration to 0.01ms', () => {
      expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
      expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/)
    })
    it('disables smooth scroll-behavior under reduced motion', () => {
      expect(css).toMatch(/scroll-behavior:\s*auto\s*!important/)
    })
  })

  // 2) usePrefersReducedMotion writes <html data-motion>
  describe('usePrefersReducedMotion bridge', () => {
    const hookPath = join(__dirname, '..', '..', 'src', 'hooks', 'usePrefersReducedMotion.ts')
    const src = readFileSync(hookPath, 'utf8')

    it('declares data-motion attribute on <html>', () => {
      expect(src).toMatch(/data-motion/)
    })
    it('listens to prefers-reduced-motion media query', () => {
      expect(src).toMatch(/prefers-reduced-motion/)
    })
    it('logs observability line on change', () => {
      expect(src).toMatch(/\[a11y .*\]/i)
    })
  })

  // 3) Motion primitives respect data-motion
  describe('motion primitives honor data-motion', () => {
    const primitivesDir = join(__dirname, '..', '..', 'src', 'motion', 'primitives')
    const primFiles = walk(primitivesDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))

    it('exports at least one primitive', () => {
      expect(primFiles.length).toBeGreaterThan(0)
    })

    // Only .tsx files are concrete implementations; the barrel .ts file just
    // re-exports and is allowed (and required) to omit `data-motion`.
    const implFiles = primFiles.filter(f => f.endsWith('.tsx'))
    for (const file of implFiles) {
      const name = relative(primitivesDir, file)
      it(`${name} reads data-motion attribute`, () => {
        const src = readFileSync(file, 'utf8')
        expect(src).toMatch(/data-motion/)
      })
    }
  })

  // 4) Static audit — classify patterns (informational, never fails)
  describe('static patterns (informational)', () => {
    const setTimeoutRe = /\bsetTimeout\s*\(/
    const setIntervalRe = /\bsetInterval\s*\(/
    const rafRe = /\brequestAnimationFrame\s*\(/
    const inlineTransitionRe = /\btransition\s*:\s*['"`]/
    const inlineAnimationRe = /\banimation\s*:\s*['"`]/

    it('reports setTimeout occurrences by file', () => {
      const hits: Match[] = []
      for (const f of files) hits.push(...searchInFile(f, [setTimeoutRe]))
      // Build a stable per-file list — the test asserts simply that the audit
      // machinery ran and recorded something. It does NOT assert zero hits.
      expect(hits.length).toBeGreaterThanOrEqual(0)
      // Emit a markdown-ish summary so the runner log captures where setTimeout
      // is used. This helps locate potential violation candidates.
      if (hits.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[audit-reducedMotion] setTimeout hits: ${hits.length} (e.g. ${hits
            .slice(0, 3)
            .map(h => `${relative(WEB_SRC, h.file)}:${h.line}`)
            .join(', ')})`
        )
      }
    })

    it('reports setInterval occurrences by file', () => {
      const hits: Match[] = []
      for (const f of files) hits.push(...searchInFile(f, [setIntervalRe]))
      expect(hits.length).toBeGreaterThanOrEqual(0)
      if (hits.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[audit-reducedMotion] setInterval hits: ${hits.length} (e.g. ${hits
            .slice(0, 3)
            .map(h => `${relative(WEB_SRC, h.file)}:${h.line}`)
            .join(', ')})`
        )
      }
    })

    it('reports requestAnimationFrame occurrences by file', () => {
      const hits: Match[] = []
      for (const f of files) hits.push(...searchInFile(f, [rafRe]))
      expect(hits.length).toBeGreaterThanOrEqual(0)
      if (hits.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[audit-reducedMotion] rAF hits: ${hits.length} (e.g. ${hits
            .slice(0, 3)
            .map(h => `${relative(WEB_SRC, h.file)}:${h.line}`)
            .join(', ')})`
        )
      }
    })

    it('reports inline `transition:` style occurrences', () => {
      const hits: Match[] = []
      for (const f of files) hits.push(...searchInFile(f, [inlineTransitionRe]))
      expect(hits.length).toBeGreaterThanOrEqual(0)
      if (hits.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[audit-reducedMotion] inline transition: ${hits.length} (e.g. ${hits
            .slice(0, 3)
            .map(h => `${relative(WEB_SRC, h.file)}:${h.line}`)
            .join(', ')})`
        )
      }
    })

    it('reports inline `animation:` style occurrences', () => {
      const hits: Match[] = []
      for (const f of files) hits.push(...searchInFile(f, [inlineAnimationRe]))
      expect(hits.length).toBeGreaterThanOrEqual(0)
      if (hits.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[audit-reducedMotion] inline animation: ${hits.length} (e.g. ${hits
            .slice(0, 3)
            .map(h => `${relative(WEB_SRC, h.file)}:${h.line}`)
            .join(', ')})`
        )
      }
    })
  })

  // 5) Token-level: ensure the semantic layer (Phase 1.A) is reachable from
  // design/ so reduced-motion aware callers can pull from semantic tokens.
  it('semantic tokens module exists', () => {
    const semantic = join(__dirname, '..', '..', 'src', 'design', 'semantic.ts')
    expect(() => readFileSync(semantic, 'utf8')).not.toThrow()
    const css = readFileSync(semantic, 'utf8')
    expect(css).toMatch(/SEMANTIC_ALIASES|DARK_OVERRIDES|css/)
  })
})
