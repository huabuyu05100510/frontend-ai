// 模型：claude-sonnet-4-6
// useTranslationMemory — CRUD + debounced lookup (250ms)

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TmEntry } from '../types'

export interface UseTranslationMemoryResult {
  entries: TmEntry[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (source: string, target: string, context?: string) => Promise<TmEntry | null>
  remove: (id: string) => Promise<boolean>
  lookup: (query: string, threshold?: number) => Promise<TmEntry[]>
}

const DEFAULT_DEBOUNCE_MS = 250

async function readError(r: Response): Promise<string> {
  try {
    const j = await r.json()
    if (j?.error) return j.error
  } catch {}
  return `${r.status} ${r.statusText}`
}

export function useTranslationMemory(sourceLang: string, targetLang: string): UseTranslationMemoryResult {
  const [entries, setEntries] = useState<TmEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!sourceLang || !targetLang) {
      setEntries([])
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(
        `/api/translate/memory?sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`,
        { credentials: 'same-origin' },
      )
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json() as { items: TmEntry[] }
      if (mounted.current) setEntries(data.items || [])
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      if (mounted.current) setLoading(false)
    }
  }, [sourceLang, targetLang])

  useEffect(() => { void refresh() }, [refresh])

  const add = useCallback(async (source: string, target: string, context?: string): Promise<TmEntry | null> => {
    try {
      const r = await fetch('/api/translate/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceLang, targetLang, source, target, context }),
      })
      if (!r.ok) throw new Error(await readError(r))
      const entry = await r.json() as TmEntry
      if (mounted.current) setEntries(prev => [entry, ...prev.filter(e => e.id !== entry.id)])
      return entry
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [sourceLang, targetLang])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const r = await fetch(
        `/api/translate/memory/${encodeURIComponent(id)}?sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      if (!r.ok) return false
      if (mounted.current) setEntries(prev => prev.filter(e => e.id !== id))
      return true
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [sourceLang, targetLang])

  const lookup = useCallback((query: string, threshold = 0.7): Promise<TmEntry[]> => {
    return new Promise<TmEntry[]>((resolve) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(async () => {
        if (!query || !sourceLang || !targetLang) {
          resolve([])
          return
        }
        try {
          const url = `/api/translate/memory?sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}&q=${encodeURIComponent(query)}&threshold=${threshold}`
          const r = await fetch(url, { credentials: 'same-origin' })
          if (!r.ok) { resolve([]); return }
          const data = await r.json() as { items: TmEntry[] }
          // Apply threshold filter (defense-in-depth; server may also filter)
          const filtered = (data.items || []).filter(e => (e.score ?? 1) >= threshold)
          resolve(filtered)
        } catch {
          resolve([])
        }
      }, DEFAULT_DEBOUNCE_MS)
    })
  }, [sourceLang, targetLang])

  return { entries, loading, error, refresh, add, remove, lookup }
}
