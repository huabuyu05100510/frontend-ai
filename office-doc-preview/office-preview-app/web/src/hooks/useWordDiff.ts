// 模型：claude-sonnet-4-6
// useWordDiff — fetch word-level diff from /api/inspect/translate/word-diff
//
// 缓存：按 (taskId|standalone):(segmentId) 维度做 in-memory LRU
// 状态：{ result, loading, error, refresh }
//
// 日志：[word-diff ISO] task=... seg=... srcTokens=... tgtTokens=... ms=... (success)
//       [word-diff ISO] task=... seg=... error=... (failure)

import { useCallback, useEffect, useRef, useState } from 'react'

export interface WordDiffOp {
  op: 'equal' | 'delete' | 'insert'
  text: string
}

export interface WordDiffResult {
  srcTokens: string[]
  tgtTokens: string[]
  srcOffsets: Array<[number, number]>
  tgtOffsets: Array<[number, number]>
  ops: WordDiffOp[]
  srcChars: number
  tgtChars: number
  ms: number
  langPair: [string, string]
}

export interface UseWordDiffArgs {
  taskId?: string
  segmentId?: string
  source: string
  target: string
  langPair?: [string, string]
  /** 自动 fetch（默认 true） */
  auto?: boolean
}

export interface UseWordDiffResult {
  result: WordDiffResult | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

interface CacheEntry {
  ts: number
  result: WordDiffResult
}

const CACHE_MAX = 32
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 min
const cache = new Map<string, CacheEntry>()

function cacheKey(taskId: string | undefined, segmentId: string | undefined): string {
  return `${taskId || 'standalone'}:${segmentId || ''}`
}

function getCached(key: string): WordDiffResult | null {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return e.result
}

function setCached(key: string, result: WordDiffResult) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.set(key, { ts: Date.now(), result })
}

export function useWordDiff(args: UseWordDiffArgs): UseWordDiffResult {
  const { taskId, segmentId, source, target, langPair, auto = true } = args
  const [result, setResult] = useState<WordDiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const lastKey = useRef<string>('')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const fetchDiff = useCallback(async () => {
    const key = cacheKey(taskId, segmentId)
    lastKey.current = key

    // 缓存命中 → 直接返回
    const cached = getCached(key)
    if (cached) {
      setResult(cached)
      setError(null)
      return
    }

    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    const t0 = Date.now()
    try {
      const r = await fetch('/api/inspect/translate/word-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          taskId: taskId || 'standalone',
          segmentId,
          source,
          target,
          langPair: langPair || ['zh', 'en'],
        }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => r.statusText)
        throw new Error(`word-diff ${r.status}: ${text}`)
      }
      const data = (await r.json()) as WordDiffResult
      if (!mounted.current || lastKey.current !== key) return
      setCached(key, data)
      setResult(data)
      const ms = Date.now() - t0
      console.info(
        `[word-diff ${new Date().toISOString()}] task=${taskId || 'standalone'} seg=${segmentId || ''} srcTokens=${data.srcTokens.length} tgtTokens=${data.tgtTokens.length} ops=${data.ops.length} ms=${ms}`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (mounted.current && lastKey.current === key) {
        setError(msg)
        console.error(
          `[word-diff ${new Date().toISOString()}] task=${taskId || 'standalone'} seg=${segmentId || ''} error=${msg}`,
        )
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setLoading(false)
    }
  }, [taskId, segmentId, source, target, langPair])

  useEffect(() => {
    if (!auto) return
    if (!source || !target) {
      setResult(null)
      return
    }
    fetchDiff()
  }, [auto, source, target, fetchDiff])

  return { result, loading, error, refresh: fetchDiff }
}
