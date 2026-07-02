import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shouldLoadMotion, loadMotion } from '../../src/motion/loadMotion'

describe('loadMotion', () => {
  beforeEach(() => {
    // Clean URL and localStorage between tests
    window.history.replaceState({}, '', '/')
    localStorage.clear()
  })

  it('shouldLoadMotion returns false by default', () => {
    expect(shouldLoadMotion()).toBe(false)
  })

  it('shouldLoadMotion returns true when ?motion=on in URL', () => {
    window.history.replaceState({}, '', '/?motion=on')
    expect(shouldLoadMotion()).toBe(true)
  })

  it('shouldLoadMotion returns true when localStorage.motion === "on"', () => {
    localStorage.setItem('motion', 'on')
    expect(shouldLoadMotion()).toBe(true)
  })

  it('shouldLoadMotion respects ?motion=off overriding localStorage', () => {
    localStorage.setItem('motion', 'on')
    window.history.replaceState({}, '', '/?motion=off')
    expect(shouldLoadMotion()).toBe(false)
  })

  it('loadMotion is a no-op when shouldLoadMotion() returns false', async () => {
    const result = await loadMotion()
    expect(result).toBeNull()
  })
})
