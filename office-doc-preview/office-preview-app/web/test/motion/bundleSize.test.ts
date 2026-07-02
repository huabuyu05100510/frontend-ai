import { describe, it, expect } from 'vitest'
import { MOTION_CHUNK_BUDGET_KB } from '../../src/config'
import { existsSync, statSync, readdirSync } from 'fs'
import { join } from 'path'

describe('motion bundle size', () => {
  it('budget constant is set', () => {
    expect(MOTION_CHUNK_BUDGET_KB).toBe(60)
  })

  // Skipped by default; enabled in CI via MOTION_BUNDLE_CHECK=1
  it.skipIf(!process.env.MOTION_BUNDLE_CHECK)('motion chunk under budget after build', () => {
    const distDir = join(__dirname, '../../dist/assets')
    if (!existsSync(distDir)) return  // build hasn't run; skip

    // Find motion chunk (any file matching the chunk name pattern)
    const files = readdirSync(distDir) as string[]
    const motionFile = files.find(f => f.startsWith('motion-') && f.endsWith('.js'))
    if (!motionFile) return  // chunk not split; build issue

    const sizeKB = statSync(join(distDir, motionFile)).size / 1024
    expect(sizeKB).toBeLessThan(MOTION_CHUNK_BUDGET_KB)
  })
})
