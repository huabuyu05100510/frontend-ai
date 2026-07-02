// 模型：claude-sonnet-4-6
// useWorkspaceTimeline — workspace timeline CRUD hook
//
// 包装 /api/workspace/timeline* 端点，提供：
//   - entries: TimelineEntry[]
//   - loading: boolean
//   - error: string | null
//   - load(): 拉取最近条目（防抖：飞行中请求被忽略）
//   - append(input): 追加条目并 prepend 到本地 entries
//   - remove(id): 删除条目
//   - clear(): 清空
//
// 反向顺序：服务端按 ts desc 返回，本地 entries 保持 desc。
// 去重：append/remove 后再 load() 一次以避免与服务端漂移。

import { useCallback, useEffect, useRef, useState } from 'react'

export type TimelineKind = 'upload' | 'translate' | 'qc' | 'ocr' | 'voice'

export interface TimelineEntry {
  id: string
  kind: TimelineKind
  taskId: string | null
  summary: string
  ts: number
  tsIso?: string
  meta?: Record<string, unknown> | null
}

export interface AppendInput {
  kind: TimelineKind
  taskId?: string
  summary: string
  meta?: Record<string, unknown>
}

export interface UseWorkspaceTimelineResult {
  entries: TimelineEntry[]
  loading: boolean
  error: string | null
  load: (opts?: { kind?: TimelineKind; limit?: number }) => Promise<void>
  append: (input: AppendInput) => Promise<TimelineEntry | null>
  remove: (id: string) => Promise<boolean>
  clear: () => Promise<void>
}

interface UseWorkspaceTimelineOptions {
  userId?: string
  /** 自动初始 load（默认 true） */
  autoLoad?: boolean
  /** 默认 limit */
  limit?: number
  /** 默认 kind 过滤 */
  kind?: TimelineKind
}

async function fetchJSON<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init)
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  return await r.json() as T
}

export function useWorkspaceTimeline(opts: UseWorkspaceTimelineOptions = {}): UseWorkspaceTimelineResult {
  const { userId, autoLoad = true, limit = 50, kind } = opts
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)

  // mounted ref for cleanup
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (userId) headers['x-user-id'] = userId

  const load = useCallback(async (loadOpts?: { kind?: TimelineKind; limit?: number }) => {
    // 防抖：若已有飞行中请求，跳过本次
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      const useKind = loadOpts?.kind ?? kind
      const useLimit = loadOpts?.limit ?? limit
      if (useKind) params.set('kind', useKind)
      if (useLimit) params.set('limit', String(useLimit))
      const qs = params.toString()
      const url = '/api/workspace/timeline' + (qs ? '?' + qs : '')
      const j = await fetchJSON<{ entries: TimelineEntry[] }>(url, { headers })
      if (mounted.current) setEntries(j.entries || [])
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      if (mounted.current) setLoading(false)
    }
  }, [kind, limit, userId])

  const append = useCallback(async (input: AppendInput): Promise<TimelineEntry | null> => {
    try {
      const j = await fetchJSON<{ ok: boolean; entry: TimelineEntry }>('/api/workspace/timeline', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })
      if (mounted.current && j.entry) {
        // prepend if newer than current head, otherwise append
        setEntries(prev => {
          if (prev.length === 0) return [j.entry]
          return j.entry.ts >= prev[0].ts ? [j.entry, ...prev] : [...prev, j.entry]
        })
      }
      return j.entry
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [userId])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/workspace/timeline/${id}`, { method: 'DELETE', headers })
      if (!r.ok) return false
      if (mounted.current) {
        setEntries(prev => prev.filter(e => e.id !== id))
      }
      return true
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [userId])

  const clear = useCallback(async (): Promise<void> => {
    try {
      await fetchJSON<{ ok: boolean; cleared: number }>('/api/workspace/timeline/clear', {
        method: 'POST',
        headers,
        body: '{}',
      })
      if (mounted.current) setEntries([])
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [userId])

  // 自动 load
  useEffect(() => {
    if (autoLoad) {
      // micro-delay to dedupe with sibling hooks' initial loads
      const t = setTimeout(() => { load() }, 0)
      return () => clearTimeout(t)
    }
  }, [autoLoad, load])

  return { entries, loading, error, load, append, remove, clear }
}