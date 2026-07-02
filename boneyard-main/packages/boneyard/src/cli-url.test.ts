import { describe, it, expect } from 'bun:test'
// @ts-expect-error — JS module without .d.ts; the helpers are pure
import { hasNonRootPath, isSinglePageMode } from '../bin/url-helpers.js'

// ── hasNonRootPath ─────────────────────────────────────────────────────────

describe('hasNonRootPath', () => {
  it('returns false for a bare origin', () => {
    expect(hasNonRootPath('http://localhost:3000')).toBe(false)
  })

  it('returns false for the root path', () => {
    expect(hasNonRootPath('http://localhost:3000/')).toBe(false)
  })

  it('returns true for a single-segment path', () => {
    expect(hasNonRootPath('http://localhost:3000/dashboard')).toBe(true)
  })

  it('returns true for a multi-segment path', () => {
    expect(hasNonRootPath('http://localhost:3000/dashboard/analytics')).toBe(true)
  })

  it('ignores query strings and fragments — only the path matters', () => {
    expect(hasNonRootPath('http://localhost:3000/?tab=1')).toBe(false)
    expect(hasNonRootPath('http://localhost:3000/foo?tab=1#section')).toBe(true)
  })

  it('handles https and non-default ports', () => {
    expect(hasNonRootPath('https://example.com')).toBe(false)
    expect(hasNonRootPath('https://example.com/app')).toBe(true)
    expect(hasNonRootPath('http://localhost:5173/admin/users')).toBe(true)
  })

  it('returns false for malformed URLs (never accidentally activate single-page mode)', () => {
    expect(hasNonRootPath('not-a-url')).toBe(false)
    expect(hasNonRootPath('')).toBe(false)
    // @ts-expect-error — testing runtime defensiveness
    expect(hasNonRootPath(null)).toBe(false)
  })
})

// ── isSinglePageMode ──────────────────────────────────────────────────────

describe('isSinglePageMode', () => {
  it('returns false for the empty list (no URL → auto-detect → crawl)', () => {
    expect(isSinglePageMode([])).toBe(false)
  })

  it('returns false for a single bare origin (the default crawl entry)', () => {
    expect(isSinglePageMode(['http://localhost:3000'])).toBe(false)
  })

  it('returns true for a single URL with a path', () => {
    expect(isSinglePageMode(['http://localhost:3000/dashboard/analytics'])).toBe(true)
  })

  it('returns true if any URL in the list has a non-root path', () => {
    expect(isSinglePageMode([
      'http://localhost:3000',
      'http://localhost:3000/dashboard',
    ])).toBe(true)
  })

  it('returns false if every URL is a bare origin', () => {
    expect(isSinglePageMode([
      'http://localhost:3000',
      'http://localhost:4000',
    ])).toBe(false)
  })

  it('handles non-array inputs defensively', () => {
    // @ts-expect-error — testing runtime defensiveness
    expect(isSinglePageMode(null)).toBe(false)
    // @ts-expect-error — testing runtime defensiveness
    expect(isSinglePageMode(undefined)).toBe(false)
  })
})
