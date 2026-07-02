import { describe, it, expect } from 'bun:test'
// @ts-expect-error — JS module without .d.ts; pure helper
import { mergePreservingExisting } from '../bin/bone-merge.js'

describe('mergePreservingExisting', () => {
  it('keeps skeletons that only exist in the loaded/existing set (fixes #81)', () => {
    const collected: Record<string, any> = { dashboard: { bones: [1] } }
    const existing: Record<string, any> = { login: { bones: [2] } }
    const out = mergePreservingExisting(collected, existing)
    expect(Object.keys(out).sort()).toEqual(['dashboard', 'login'])
    expect(out.login).toEqual({ bones: [2] })
  })

  it('freshly-captured data wins over loaded data for the same skeleton', () => {
    const collected: Record<string, any> = { dashboard: { bones: [999], fresh: true } }
    const existing: Record<string, any> = { dashboard: { bones: [1] }, login: { bones: [2] } }
    mergePreservingExisting(collected, existing)
    expect(collected.dashboard).toEqual({ bones: [999], fresh: true })
    expect(collected.login).toEqual({ bones: [2] })
  })

  it('mutates collected in place and also returns it', () => {
    const collected: Record<string, any> = {}
    const existing: Record<string, any> = { a: 1 }
    const out = mergePreservingExisting(collected, existing)
    expect(out).toBe(collected)
    expect(collected).toEqual({ a: 1 })
  })

  it('handles an empty existing map — collected unchanged', () => {
    const collected: Record<string, any> = { a: 1 }
    mergePreservingExisting(collected, {})
    expect(collected).toEqual({ a: 1 })
  })

  it('handles an empty collected map — all existing entries imported', () => {
    const collected: Record<string, any> = {}
    const existing: Record<string, any> = { a: 1, b: 2 }
    mergePreservingExisting(collected, existing)
    expect(collected).toEqual({ a: 1, b: 2 })
  })

  it('defensive against null/undefined inputs', () => {
    // @ts-expect-error — runtime defensiveness
    expect(mergePreservingExisting(null, { a: 1 })).toBe(null)
    const c: Record<string, any> = { a: 1 }
    // @ts-expect-error — runtime defensiveness
    expect(mergePreservingExisting(c, null)).toBe(c)
    expect(c).toEqual({ a: 1 })
  })

  it('preserves the auth-then-login reproduction from #81', () => {
    // Run 1 (unauthenticated): /login captured, written to disk.
    const run1Existing = {
      login: { breakpoints: { 375: { bones: [[0, 0, 100, 40, 8]] } }, _hash: 'abc' },
    }
    // Run 2 (authed cookies added): /login now redirects to /dashboard;
    // only dashboard is captured this run.
    const run2Collected: Record<string, any> = {
      dashboard: { breakpoints: { 375: { bones: [[0, 0, 100, 200, 8]] } }, _hash: 'def' },
    }
    mergePreservingExisting(run2Collected, run1Existing)
    // Both should survive into the regenerated registry.
    expect(Object.keys(run2Collected).sort()).toEqual(['dashboard', 'login'])
    expect(run2Collected.login).toEqual(run1Existing.login)
  })
})
