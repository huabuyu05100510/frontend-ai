/**
 * EventBus ↔ React state 双向桥接 Hook
 *
 * 将 EventBus 事件同步到 React state，自动管理订阅/取消订阅。
 *
 * @module hooks/useAnnotationSync
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { EventBus } from '../core/EventBus';
import type { Annotation } from '../core/types';
import type { AnnotationStore } from '../core/AnnotationStore';

/**
 * 订阅 EventBus，将标注数据同步到 React state
 */
export function useAnnotationSync(
  store: AnnotationStore,
  eventBus: EventBus,
) {
  const [annotations, setAnnotations] = useState<Annotation[]>(() => store.getAll());
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      eventBus.on('ANNOTATIONS_LOADED', ({ annotations: loaded }) => {
        setAnnotations([...loaded]);
      }),

      eventBus.on('ANNOTATION_HOVER', ({ id }) => {
        setActiveId(id);
      }),

      eventBus.on('ANNOTATION_SELECT', ({ id }) => {
        setActiveId(id);
      }),

      eventBus.on('ANNOTATION_ACCEPT', ({ id }) => {
        setAnnotations(prev => prev.filter(a => a.id !== id));
        setActiveId(null);
      }),

      eventBus.on('ANNOTATION_IGNORE', ({ id }) => {
        setAnnotations(prev => prev.map(a =>
          a.id === id ? { ...a, status: 'ignored' as const } : a,
        ));
      }),

      eventBus.on('FIELD_SAVED', () => {
        setAnnotations(store.getAll());
      }),

      eventBus.on('FIELD_DELETED', () => {
        setAnnotations(store.getAll());
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [store, eventBus]);

  const focusNext = useCallback(() => {
    const all = store.getByStatus('active');
    if (all.length === 0) return;

    const currentIndex = activeId
      ? all.findIndex(a => a.id === activeId)
      : -1;
    const nextIndex = (currentIndex + 1) % all.length;
    const nextId = all[nextIndex].id;

    setActiveId(nextId);
    eventBus.emit({ type: 'SCROLL_TO', annotationId: nextId });
  }, [store, eventBus, activeId]);

  const focusPrev = useCallback(() => {
    const all = store.getByStatus('active');
    if (all.length === 0) return;

    const currentIndex = activeId
      ? all.findIndex(a => a.id === activeId)
      : all.length;
    const prevIndex = (currentIndex - 1 + all.length) % all.length;
    const prevId = all[prevIndex].id;

    setActiveId(prevId);
    eventBus.emit({ type: 'SCROLL_TO', annotationId: prevId });
  }, [store, eventBus, activeId]);

  return {
    annotations,
    activeId,
    setActiveId,
    focusNext,
    focusPrev,
  };
}