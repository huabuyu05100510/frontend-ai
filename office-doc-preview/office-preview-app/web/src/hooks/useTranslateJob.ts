// 模型：claude-sonnet-4-6
// useTranslateJob — polling hook for translate job progress (doc + image batch)
//
// 1s poll interval (configurable). Stops on terminal status (finished/failed/cancelled).
// In-flight dedup per jobId. Cleanup on unmount. Hook order: ALL useCallback/useMemo/useEffect
// before any conditional return.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslateJobFrame } from '../types'

export type TranslateJobStatus =
  | 'idle' | 'started' | 'running' | 'finished' | 'failed' | 'cancelled' | 'paused' | 'resumed'

export interface UseTranslateJobOptions {
  pollMs?: number
  onComplete?: (frames: TranslateJobFrame[]) => void
  onError?: (err: Error) => void
}

export interface UseTranslateJobResult {
  frames: TranslateJobFrame[]
  status: TranslateJobStatus
  lastSeq: number
  completed: number
  total: number
  error: string | null
  cancel: () => Promise<boolean>
  refresh: () => Promise<void>
}

const TERMINAL: TranslateJobStatus[] = ['finished', 'failed', 'cancelled']

function readHeader(headers: Headers, name: string): string | null {
  return headers.get(name) || headers.get(name.toLowerCase()) || null
}

function parseStatus(raw: string | null): TranslateJobStatus {
  if (!raw) return 'running'
  const v = raw.toLowerCase() as TranslateJobStatus
  if (['idle', 'started', 'running', 'finished', 'failed', 'cancelled', 'paused', 'resumed'].includes(v)) {
    return v
  }
  return 'running'
}

export function useTranslateJob(jobId: string | null, opts: UseTranslateJobOptions = {}): UseTranslateJobResult {
  const { pollMs = 1000, onComplete, onError } = opts

  const [frames, setFrames] = useState<TranslateJobFrame[]>([])
  const [status, setStatus] = useState<TranslateJobStatus>('idle')
  const [lastSeq, setLastSeq] = useState(0)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Refs (all declared before any effect)
  const inFlight = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const lastSeqRef = useRef(0)
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)
  const jobIdRef = useRef(jobId)

  // mounted flag
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Sync callbacks + jobId into refs
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onErrorRef.current = onError }, [onError])
  useEffect(() => { jobIdRef.current = jobId }, [jobId])

  // Reset state on jobId change
  useEffect(() => {
    setFrames([])
    setStatus('idle')
    setLastSeq(0)
    setCompleted(0)
    setTotal(0)
    setError(null)
    lastSeqRef.current = 0
    if (inFlight.current) {
      inFlight.current.abort()
      inFlight.current = null
    }
  }, [jobId])

  const poll = useCallback(async (): Promise<void> => {
    const id = jobIdRef.current
    if (!id) return
    // Dedup: skip if a request for THIS jobId is already in-flight
    if (inFlight.current) return
    const ctrl = new AbortController()
    inFlight.current = ctrl
    try {
      const since = lastSeqRef.current
      const r = await fetch(`/api/inspect/translate/progress/${encodeURIComponent(id)}?sinceSeq=${since}`, {
        credentials: 'same-origin',
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`progress ${r.status}`)
      const hdrStatus = parseStatus(readHeader(r.headers, 'X-Job-Status'))
      const data = await r.json() as { jobId: string; lastSeq: number; frames: TranslateJobFrame[] }
      if (!mounted.current) return
      const incoming = Array.isArray(data.frames) ? data.frames : []
      if (incoming.length > 0) {
        setFrames(prev => [...prev, ...incoming])
        // Update derived counts
        let newCompleted = 0
        let newTotal = 0
        for (const f of [...framesRef.current, ...incoming]) {
          if (f.kind === 'started' && typeof (f.payload as { totalPages?: number }).totalPages === 'number') {
            newTotal = (f.payload as { totalPages: number }).totalPages
          }
          if (f.kind === 'page-done') newCompleted++
          if (f.kind === 'image-done') newCompleted++
        }
        if (newTotal > 0) setTotal(newTotal)
        setCompleted(newCompleted)
      }
      if (typeof data.lastSeq === 'number') {
        setLastSeq(data.lastSeq)
        lastSeqRef.current = data.lastSeq
      }
      setStatus(hdrStatus)
      if (TERMINAL.includes(hdrStatus)) {
        if (onCompleteRef.current) onCompleteRef.current([...framesRef.current, ...incoming])
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      const msg = e instanceof Error ? e.message : String(e)
      if (mounted.current) setError(msg)
      if (onErrorRef.current && e instanceof Error) onErrorRef.current(e)
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null
    }
  }, [])

  // Refs for poll to read latest frames (avoid stale closure)
  const framesRef = useRef(frames)
  useEffect(() => { framesRef.current = frames }, [frames])

  const refresh = useCallback(async () => {
    await poll()
  }, [poll])

  const cancel = useCallback(async (): Promise<boolean> => {
    const id = jobIdRef.current
    if (!id) return false
    try {
      const r = await fetch(`/api/translate/image/batch/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      return r.ok
    } catch {
      return false
    }
  }, [])

  // Polling loop
  useEffect(() => {
    if (!jobId) return
    // Kick off immediate poll (it dedupes internally)
    poll()
    const timer = setInterval(() => {
      if (TERMINAL.includes(statusRef.current)) {
        clearInterval(timer)
        return
      }
      poll()
    }, pollMs)
    return () => clearInterval(timer)
  }, [jobId, pollMs, poll])

  // Status ref for the interval callback
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  return { frames, status, lastSeq, completed, total, error, cancel, refresh }
}
