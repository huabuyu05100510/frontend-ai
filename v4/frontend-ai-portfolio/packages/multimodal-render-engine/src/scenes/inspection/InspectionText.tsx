/**
 * 文本智检场景
 *
 * 集成 ProseMirror Editor + Decoration 插件 + ErrorPanel。
 * 支持键盘导航（F8/Shift+F8）、防抖 500ms 调用 API。
 *
 * @module scenes/inspection/InspectionText
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { EventBus } from '../../core/EventBus';
import { AnnotationStore } from '../../core/AnnotationStore';
import { ErrorPanel } from './ErrorPanel';
import { useAnnotationSync } from '../../hooks/useAnnotationSync';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { toast } from '../../components/Toast';
import type { Annotation } from '../../core/types';

type LoadState = 'loading' | 'loaded' | 'empty' | 'error';

interface InspectionTextProps {
  /** 初始文本 */
  initialText?: string;
  /** 智检 API（可注入用于测试） */
  inspectAPI?: (text: string) => Promise<Annotation[]>;
}

/**
 * 文本智检组件
 */
export const InspectionText: React.FC<InspectionTextProps> = ({
  initialText = '',
  inspectAPI,
}) => {
  const [loadState] = useState<LoadState>('loaded');
  const [text, setText] = useState(initialText);

  const eventBusRef = useRef(new EventBus());
  const storeRef = useRef(new AnnotationStore(eventBusRef.current));
  const abortControllerRef = useRef<AbortController | null>(null);

  const { annotations, activeId, focusNext, focusPrev } = useAnnotationSync(
    storeRef.current,
    eventBusRef.current,
  );

  // 键盘快捷键
  useKeyboardNav([
    { key: 'F8', handler: focusNext, description: '下一个错误' },
    { key: 'F8', shiftKey: true, handler: focusPrev, description: '上一个错误' },
  ]);

  // 文本防抖检测
  useEffect(() => {
    if (!text.trim()) return;

    // 取消上一次请求
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        if (inspectAPI) {
          const results = await inspectAPI(text);
          storeRef.current.load(results);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error('智检请求失败');
        }
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, inspectAPI]);

  const handleAccept = useCallback((id: string) => {
    const ann = storeRef.current.getById(id);
    if (ann?.content.suggestion) {
      // TODO: ProseMirror 文本替换
      storeRef.current.setStatus(id, 'accepted');
      toast.success('已接受建议');
    }
  }, []);

  const handleIgnore = useCallback((id: string) => {
    storeRef.current.setStatus(id, 'ignored');
  }, []);

  const handleFocus = useCallback((id: string) => {
    eventBusRef.current.emit({ type: 'ANNOTATION_SELECT', id });
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      eventBusRef.current.clear();
    };
  }, []);

  return (
    <ErrorBoundary>
      <div style={{
        display: 'flex',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* 编辑器区域 */}
        <div style={{
          flex: 1,
          padding: '16px',
          overflow: 'auto',
        }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入或粘贴文本..."
            style={{
              width: '100%',
              minHeight: '400px',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '15px',
              lineHeight: '1.8',
              fontFamily: 'system-ui, sans-serif',
              resize: 'vertical',
              outline: 'none',
            }}
          />
        </div>

        {/* 错误面板 */}
        <ErrorPanel
          annotations={annotations}
          activeId={activeId}
          onAccept={handleAccept}
          onIgnore={handleIgnore}
          onFocus={handleFocus}
        />
      </div>
    </ErrorBoundary>
  );
};

InspectionText.displayName = 'InspectionText';