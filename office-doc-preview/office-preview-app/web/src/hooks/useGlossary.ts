// 模型：claude-sonnet-4-6
// useGlossary — CRUD wrapper around glossary API
//
// Endpoints:
//   GET    /api/translate/glossary?sourceLang=&targetLang=
//   POST   /api/translate/glossary
//   DELETE /api/translate/glossary/:id?sourceLang=&targetLang=
//   POST   /api/translate/glossary/import  (multipart)
// applyTo() applies longest-first in-place substitution.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlossaryTerm } from '../types'

export interface UseGlossaryResult {
  terms: GlossaryTerm[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (source: string, target: string, pos?: string, note?: string) => Promise<GlossaryTerm | null>
  remove: (id: string) => Promise<boolean>
  importCsv: (file: File) => Promise<{ imported: number; duplicates: number } | null>
  applyTo: (text: string) => string
}

async function readError(r: Response): Promise<string> {
  try {
    const j = await r.json()
    if (j?.error) return j.error
  } catch {}
  return `${r.status} ${r.statusText}`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function useGlossary(sourceLang: string, targetLang: string): UseGlossaryResult {
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!sourceLang || !targetLang) {
      setTerms([])
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(
        `/api/translate/glossary?sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`,
        { credentials: 'same-origin' },
      )
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json() as { items: GlossaryTerm[] }
      if (mounted.current) setTerms(data.items || [])
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      if (mounted.current) setLoading(false)
    }
  }, [sourceLang, targetLang])

  useEffect(() => { void refresh() }, [refresh])

  const add = useCallback(async (source: string, target: string, pos?: string, note?: string): Promise<GlossaryTerm | null> => {
    try {
      const r = await fetch('/api/translate/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceLang, targetLang, source, target, pos, note }),
      })
      if (!r.ok) throw new Error(await readError(r))
      const term = await r.json() as GlossaryTerm
      if (mounted.current) setTerms(prev => [term, ...prev.filter(t => t.id !== term.id)])
      return term
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [sourceLang, targetLang])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const r = await fetch(
        `/api/translate/glossary/${encodeURIComponent(id)}?sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      if (!r.ok) return false
      if (mounted.current) setTerms(prev => prev.filter(t => t.id !== id))
      return true
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [sourceLang, targetLang])

  const importCsv = useCallback(async (file: File): Promise<{ imported: number; duplicates: number } | null> => {
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('sourceLang', sourceLang)
      fd.append('targetLang', targetLang)
      const r = await fetch('/api/translate/glossary/import', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      })
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json() as { imported: number; duplicates: number }
      // Refresh list after import
      void refresh()
      return data
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [sourceLang, targetLang, refresh])

  const applyTo = useCallback((text: string): string => {
    if (!terms.length || !text) return text
    // Longest-first substitution
    const sorted = [...terms].sort((a, b) => b.source.length - a.source.length)
    let out = text
    for (const t of sorted) {
      if (!t.source) continue
      out = out.replace(new RegExp(escapeRegex(t.source), 'g'), t.target)
    }
    return out
  }, [terms])

  return { terms, loading, error, refresh, add, remove, importCsv, applyTo }
}
