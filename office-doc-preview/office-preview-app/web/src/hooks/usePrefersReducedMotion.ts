// 模型：claude-sonnet-4-6
// usePrefersReducedMotion — hook + global side-effect to set <html data-motion>
// Complies with WCAG 2.3.3 (Animation from Interactions)

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(QUERY)
    const handler = (e: MediaQueryListEvent) => {
      setReduced(e.matches)
      const ts = new Date().toISOString()
      console.info(`[a11y ${ts}] prefers-reduced-motion: ${e.matches}`)
    }
    setReduced(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Side-effect: write to <html data-motion>
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-motion', reduced ? 'off' : 'on')
  }, [reduced])

  return reduced
}
