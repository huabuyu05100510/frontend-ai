import { useState, useEffect, useCallback, useRef } from 'react'
import type { Annotation } from '../../core/types'
import type { AnnotationStore } from '../../core/AnnotationStore'
import type { EventBus } from '../../core/EventBus'

export interface UseInspectionReturn {
  annotations: Annotation[]
  activeId: string | null
  accept: (id: string) => void
  ignore: (id: string) => void
  focusNext: () => void
  focusPrev: () => void
}

/**
 * Hook encapsulating all inspection scene logic.
 * Manages annotation state, keyboard navigation, and EventBus integration.
 */
export function useInspection(bus: EventBus, store: AnnotationStore): UseInspectionReturn {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const annotationsRef = useRef<Annotation[]>([])

  // Keep refs in sync for keyboard handler (avoids stale closure)
  activeIdRef.current = activeId
  annotationsRef.current = annotations

  // Sync annotations from store whenever they change
  const syncAnnotations = useCallback(() => {
    setAnnotations([...store.getAll()])
  }, [store])

  useEffect(() => {
    const unsubs = [
      bus.on('ANNOTATIONS_LOADED', () => syncAnnotations()),
      bus.on('ANNOTATION_ADDED',   () => syncAnnotations()),
      bus.on('ANNOTATION_ACCEPT',  () => syncAnnotations()),
      bus.on('ANNOTATION_IGNORE',  () => syncAnnotations()),
      // 悬停联动：hover 到波浪线 → 右侧面板高亮对应卡片
      bus.on('ANNOTATION_HOVER',   ({ id }) => setActiveId(id)),
      // 点击面板卡片 → 定位到编辑器对应位置
      bus.on('SCROLL_TO', ({ annotationId }) => setActiveId(annotationId)),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [bus, syncAnnotations])

  const accept = useCallback((id: string) => {
    store.setStatus(id, 'accepted')
    // 立即同步 React state（双保险：EventBus 异步 + 直接调用）
    setAnnotations([...store.getAll()])
    // Move active to next annotation if the accepted one was active
    if (activeIdRef.current === id) {
      const active = store.getAll().filter(a => a.status === 'active')
      setActiveId(active.length > 0 ? active[0].id : null)
    }
  }, [store])

  const ignore = useCallback((id: string) => {
    store.setStatus(id, 'ignored')
    setAnnotations([...store.getAll()])
    if (activeIdRef.current === id) {
      const active = store.getAll().filter(a => a.status === 'active')
      setActiveId(active.length > 0 ? active[0].id : null)
    }
  }, [store])

  const getActiveAnnotations = (): Annotation[] => {
    return annotationsRef.current.filter(a => a.status === 'active' && a.type.startsWith('error-'))
  }

  const focusNext = useCallback(() => {
    const active = getActiveAnnotations()
    if (active.length === 0) return
    const currentId = activeIdRef.current
    const idx = active.findIndex(a => a.id === currentId)
    const nextIdx = (idx + 1) % active.length
    const nextId = active[nextIdx].id
    setActiveId(nextId)
    bus.emit({ type: 'SCROLL_TO', annotationId: nextId })
  }, [bus])

  const focusPrev = useCallback(() => {
    const active = getActiveAnnotations()
    if (active.length === 0) return
    const currentId = activeIdRef.current
    const idx = active.findIndex(a => a.id === currentId)
    const prevIdx = (idx - 1 + active.length) % active.length
    const prevId = active[prevIdx].id
    setActiveId(prevId)
    bus.emit({ type: 'SCROLL_TO', annotationId: prevId })
  }, [bus])

  // Keyboard: F8 → focusNext, Shift+F8 → focusPrev
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault()
        if (e.shiftKey) {
          focusPrev()
        } else {
          focusNext()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusNext, focusPrev])

  return { annotations, activeId, accept, ignore, focusNext, focusPrev }
}
