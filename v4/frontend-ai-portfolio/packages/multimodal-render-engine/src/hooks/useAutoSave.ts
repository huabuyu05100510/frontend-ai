/**
 * 草稿自动保存 Hook
 *
 * OCR 模板场景：30s 间隔自动保存草稿到 localStorage。
 * 支持 beforeunload 拦截未保存数据。
 *
 * @module hooks/useAutoSave
 */

import { useEffect, useRef, useCallback } from 'react';

const DRAFT_KEY = 'ocr-template-draft';
const SAVE_INTERVAL = 30_000; // 30s

/**
 * 自动保存草稿 Hook
 *
 * @param getData 获取当前数据
 * @param isDirty 是否有未保存的修改
 *
 * @example
 * ```ts
 * const { saveDraft, clearDraft } = useAutoSave(
 *   () => ({ fields: templateManager.getFields() }),
 *   hasUnsavedChanges,
 * );
 * ```
 */
export function useAutoSave<T>(
  getData: () => T,
  isDirty: boolean,
) {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const getDataRef = useRef(getData);
  getDataRef.current = getData;

  // 定时自动保存
  useEffect(() => {
    const timer = setInterval(() => {
      if (isDirtyRef.current) {
        try {
          const data = getDataRef.current();
          localStorage.setItem(DRAFT_KEY, JSON.stringify({
            data,
            timestamp: Date.now(),
          }));
        } catch (error) {
          console.warn('[useAutoSave] failed to save draft:', error);
        }
      }
    }, SAVE_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  // beforeunload 拦截
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '有未保存的模板，确定离开？';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  /** 手动保存草稿 */
  const saveDraft = useCallback(() => {
    try {
      const data = getData();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        data,
        timestamp: Date.now(),
      }));
    } catch (error) {
      console.warn('[useAutoSave] failed to save draft:', error);
    }
  }, []);

  /** 清除草稿 */
  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  /** 读取草稿 */
  const loadDraft = useCallback((): { data: T; timestamp: number } | null => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, []);

  return { saveDraft, clearDraft, loadDraft };
}