// 模型：claude-sonnet-4-6
// useAnnotation — CRUD wrapper around /api/translate/annotation
//
// Endpoints:
//   GET    /api/translate/annotation?taskId=xxx     → { items: Annotation[] }
//   POST   /api/translate/annotation                → { ok, id, annotation }
//   DELETE /api/translate/annotation?taskId=xxx&id=yyyy → { ok, removed }
//
// Optimistic add: push temp item with id `tmp_<ts>` to local state immediately,
// replace with server response on success, rollback on error.
// 250ms debounced auto-refresh on add/delete rapid-fire.
// ISO timestamped console.info on every action.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationKind, TranslateAnnotation } from '../types'

export interface CreateInput {
  taskId: string
  segmentId: string
  kind: AnnotationKind
  srcText?: string
  tgtText?: string
  payload: object
}

export interface UpdateInput {
  id: string
  payload?: object
  tgtText?: string
}

export interface UseAnnotationResult {
  items: TranslateAnnotation[]
  loading: boolean
  error: string | null
  bySegmentId: (segmentId: string) => TranslateAnnotation[]
  byKind: (kind: AnnotationKind) => TranslateAnnotation[]
  count: number
  addAnnotation: (input: CreateInput) => Promise<TranslateAnnotation | null>
  updateAnnotation: (input: UpdateInput) => Promise<TranslateAnnotation | null>
  removeAnnotation: (id: string) => Promise<boolean>
  refetch: () => Promise<void>
}

const REFRESH_DEBOUNCE_MS = 250

function logAction(taskId: string, action: string, extras: Record<string, unknown> = {}): void {
  const ts = new Date().toISOString()
  const parts = Object.entries(extras)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.info(`[translate-annotation ${ts}] task=${taskId} action=${action}${parts ? ' ' + parts : ''}`)
}

async function readError(r: Response): Promise<string> {
  try {
    const j = await r.json()
    if (j?.error) return j.error
  } catch {}
  return `${r.status} ${r.statusText || 'error'}`
}

export function useAnnotation(taskId: string | null): UseAnnotationResult {
  const [items, setItems] = useState<TranslateAnnotation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current)
        refreshTimer.current = null
      }
    }
  }, [])

  const refetch = useCallback(async (): Promise<void> => {
    if (!taskId) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(
        `/api/translate/annotation?taskId=${encodeURIComponent(taskId)}`,
        { credentials: 'same-origin' },
      )
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json() as { items?: TranslateAnnotation[] }
      if (mounted.current) {
        setItems(Array.isArray(data.items) ? data.items : [])
      }
      logAction(taskId, 'list', { count: Array.isArray(data.items) ? data.items.length : 0 })
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [taskId])

  // Auto-refetch on taskId change
  useEffect(() => {
    void refetch()
  }, [refetch])

  // Debounced auto-refresh helper for rapid-fire add/delete
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refetch()
    }, REFRESH_DEBOUNCE_MS)
  }, [refetch])

  const bySegmentId = useCallback((segmentId: string): TranslateAnnotation[] => {
    return items.filter(a => a.segmentId === segmentId)
  }, [items])

  const byKind = useCallback((kind: AnnotationKind): TranslateAnnotation[] => {
    return items.filter(a => a.kind === kind)
  }, [items])

  const addAnnotation = useCallback(async (input: CreateInput): Promise<TranslateAnnotation | null> => {
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const optimistic: TranslateAnnotation = {
      id: tempId,
      kind: input.kind,
      schemaVersion: 1,
      taskId: input.taskId,
      segmentId: input.segmentId,
      url: `task://${input.taskId}`,
      domPath: `seg:${input.segmentId}`,
      srcText: input.srcText ?? '',
      tgtText: input.tgtText ?? '',
      langPair: ['zh-CN', 'en'],
      srcTokens: [],
      tgtTokens: [],
      predicted: [],
      modelVersion: 'myers-word-v1',
      payload: input.payload,
      context: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // Optimistic push
    setItems(prev => [optimistic, ...prev])
    try {
      const r = await fetch('/api/translate/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(input),
      })
      if (!r.ok) {
        const msg = await readError(r)
        throw new Error(msg)
      }
      const data = await r.json() as { ok: boolean; id: string; annotation: TranslateAnnotation }
      const serverAnn = data.annotation
      if (mounted.current) {
        // Replace temp item with server response
        setItems(prev => [serverAnn, ...prev.filter(a => a.id !== tempId)])
      }
      logAction(input.taskId, 'add', { kind: input.kind, segId: input.segmentId, id: serverAnn.id })
      return serverAnn
    } catch (e) {
      // Rollback optimistic
      if (mounted.current) {
        setItems(prev => prev.filter(a => a.id !== tempId))
        setError(e instanceof Error ? e.message : String(e))
      }
      return null
    }
  }, [])

  const updateAnnotation = useCallback(async (input: UpdateInput): Promise<TranslateAnnotation | null> => {
    const existing = items.find(a => a.id === input.id)
    if (!existing) {
      // No local copy — try POSTing anyway as a fresh create with the id reused
      // (server enforces uuid format, so we just send without id and let server assign)
    }
    const target = existing ?? items.find(a => a.id === input.id)
    if (!target) {
      return null
    }
    const newPayload = input.payload ?? target.payload
    const newTgt = input.tgtText ?? target.tgtText
    // Optimistic update
    const optimistic: TranslateAnnotation = {
      ...target,
      payload: newPayload,
      tgtText: newTgt,
      updatedAt: Date.now(),
    }
    setItems(prev => prev.map(a => a.id === input.id ? optimistic : a))
    try {
      const body = {
        taskId: target.taskId,
        segmentId: target.segmentId,
        kind: target.kind,
        srcText: target.srcText,
        tgtText: newTgt,
        payload: newPayload,
      }
      const r = await fetch('/api/translate/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const msg = await readError(r)
        throw new Error(msg)
      }
      const data = await r.json() as { ok: boolean; id: string; annotation: TranslateAnnotation }
      const serverAnn = data.annotation
      if (mounted.current) {
        setItems(prev => prev.map(a => a.id === input.id ? serverAnn : a))
      }
      logAction(target.taskId, 'update', { kind: target.kind, segId: target.segmentId, id: serverAnn.id })
      return serverAnn
    } catch (e) {
      // Rollback
      if (mounted.current && target) {
        setItems(prev => prev.map(a => a.id === input.id ? target : a))
        setError(e instanceof Error ? e.message : String(e))
      }
      return null
    }
  }, [items])

  const removeAnnotation = useCallback(async (id: string): Promise<boolean> => {
    if (!taskId) return false
    const target = items.find(a => a.id === id)
    if (!target) return false
    // Optimistic remove
    setItems(prev => prev.filter(a => a.id !== id))
    try {
      const r = await fetch(
        `/api/translate/annotation?taskId=${encodeURIComponent(taskId)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      if (!r.ok) {
        // Rollback
        if (mounted.current) setItems(prev => [target, ...prev])
        return false
      }
      logAction(taskId, 'delete', { id })
      scheduleRefresh()
      return true
    } catch (e) {
      // Rollback
      if (mounted.current) setItems(prev => [target, ...prev])
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [taskId, items, scheduleRefresh])

  return {
    items,
    loading,
    error,
    bySegmentId,
    byKind,
    count: items.length,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    refetch,
  }
}