// 模型：claude-sonnet-4-6
// noInlineHex — static guard that prevents inline #RRGGBB hex literals from creeping
// back into TSX files (outside of design/palette/Modal). The design system enforces
// that colors flow through semantic.css vars, not hardcoded values.
//
// Allowlist:
//   - web/src/design/**           (semantic.ts / primitives.ts own the palette)
//   - web/src/palette/**          (palette is the cmd-k palette UI, out of scope)
//   - web/src/components/Modal.tsx (the new primitive has its own markers)
//   - *.css                       (raw CSS, evaluated separately)
//   - className= text, JSX text, comments
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../src')
const ALLOWLIST_DIRS = new Set(['design', 'palette'])
// Files owned by other Phase 2 agents (out of Phase 2.A scope)
const ALLOWLIST_FILES = new Set([
  'components/Modal.tsx',     // P2.A: the new primitive itself
  'components/RightPanel.tsx', // P2.C owns
  'components/SideMenu.tsx',   // P2.B owns
])
const HEX_RE = /#[0-9a-fA-F]{6}\b/

interface Finding { file: string; line: number; snippet: string }

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.vite') continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, files)
    else if (entry.isFile() && p.endsWith('.tsx')) files.push(p)
  }
  return files
}

function isAllowed(file: string): boolean {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  for (const dir of ALLOWLIST_DIRS) if (rel.startsWith(dir + '/')) return true
  return ALLOWLIST_FILES.has(rel)
}

describe('noInlineHex — guard against inline hex literals', () => {
  it('scans all .tsx under src and reports no #RRGGBB in inline style props', () => {
    const files = walk(ROOT)
    const findings: Finding[] = []
    const HEX_STYLE_RE = /style=\{\{[^}]*#[0-9a-fA-F]{6}[^}]*\}\}/g

    for (const file of files) {
      if (isAllowed(file)) continue
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Match style={{ ... #xxx ... }} — multi-line style blocks are rare;
        // most inline hex literals are on one line.
        let m: RegExpExecArray | null
        const re = new RegExp(HEX_STYLE_RE.source, 'g')
        while ((m = re.exec(line)) !== null) {
          // Extract the hex literal
          const hexMatch = line.slice(m.index).match(HEX_RE)
          if (hexMatch) {
            findings.push({ file: path.relative(ROOT, file), line: i + 1, snippet: hexMatch[0] })
          }
        }
      }
    }

    if (findings.length > 0) {
      const summary = findings.slice(0, 20).map(f => `  ${f.file}:${f.line} → ${f.snippet}`).join('\n')
      throw new Error(`Found ${findings.length} inline hex literal(s) in style props:\n${summary}\n(use semantic.ts CSS vars instead)`)
    }
    expect(findings).toHaveLength(0)
  })

  it('hex literal count is below the historic baseline (≤ 30 across sweepable files)', () => {
    const files = walk(ROOT).filter(f => !isAllowed(f))
    let total = 0
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      total += (content.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length
    }
    // Was 64 at start of Phase 2.A; should be much lower now (target ≤ 10)
    expect(total).toBeLessThanOrEqual(10)
  })
})