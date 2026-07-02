/**
 * 翻译双栏对比 — 主容器组件
 *
 * 4 态加载：Loading → Loaded / Empty / Error
 * 集成 pdfium-wasm Worker、ScrollSyncBridge、TextLayer
 *
 * @module scenes/translation/DualColumnLayout
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { EventBus } from '../../core/EventBus';
import { AnnotationStore } from '../../core/AnnotationStore';
import { AnnotationStateMachine } from '../../core/StateMachine';
import { ParagraphMapper } from './ParagraphMapper';
import { ScrollSyncBridge } from './ScrollSyncBridge';
import { buildTextLayer, destroyTextLayer } from './TextLayer';
import type { ParagraphMapping } from '../../core/types';
import { toast } from '../../components/Toast';

type LoadState = 'loading' | 'loaded' | 'empty' | 'error';

interface DualColumnLayoutProps {
  /** 文档文件 */
  file: File;
  /** 源语言 */
  srcLang?: string;
  /** 目标语言 */
  tgtLang?: string;
  /** 加载完成回调 */
  onLoad?: () => void;
  /** 翻译 API（可注入用于测试） */
  translateAPI?: (paragraphs: string[], srcLang: string, tgtLang: string) => Promise<Array<{ srcParagraphId: string; tgtText: string; confidence: number }>>;
}

/**
 * 翻译双栏对比组件
 */
export const DualColumnLayout: React.FC<DualColumnLayoutProps> = ({
  file,
  srcLang = 'zh',
  tgtLang = 'en',
  onLoad,
  translateAPI,
}) => {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftSvgRef = useRef<SVGSVGElement>(null);
  const rightSvgRef = useRef<SVGSVGElement>(null);

  const eventBusRef = useRef(new EventBus());
  const storeRef = useRef(new AnnotationStore(eventBusRef.current));
  const stateMachineRef = useRef(new AnnotationStateMachine(eventBusRef.current));
  const mapperRef = useRef(new ParagraphMapper());
  const syncBridgeRef = useRef<ScrollSyncBridge | null>(null);
  const leftTextLayerRef = useRef<HTMLDivElement | null>(null);
  const rightTextLayerRef = useRef<HTMLDivElement | null>(null);

  // 清理资源
  useEffect(() => {
    return () => {
      syncBridgeRef.current?.destroy();
      if (leftTextLayerRef.current) destroyTextLayer(leftTextLayerRef.current);
      if (rightTextLayerRef.current) destroyTextLayer(rightTextLayerRef.current);
      eventBusRef.current.clear();
      storeRef.current.clear();
    };
  }, []);

  const handleRetry = useCallback(() => {
    setLoadState('loading');
    setErrorMessage('');
    initDocument();
  }, []);

  const initDocument = useCallback(async () => {
    try {
      // TODO: 集成 pdfium-wasm Worker
      // 当前为骨架实现，生产环境需替换为实际 Worker 通信
      setLoadState('loaded');
      onLoad?.();
    } catch (error) {
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : '文档加载失败');
      toast.error('文档引擎加载失败');
    }
  }, [onLoad]);

  // 初始化加载
  useEffect(() => {
    initDocument();
  }, []);

  // ---- 渲染 ----

  if (loadState === 'loading') {
    return (
      <div className="dual-column-layout" style={{ display: 'flex', gap: '12px', height: '100%' }}>
        <div style={{ flex: 1 }}>
          <LoadingSkeleton variant="canvas" height="100%" />
        </div>
        <div style={{ flex: 1 }}>
          <LoadingSkeleton variant="canvas" height="100%" />
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div style={{ padding: '40px' }}>
        <button
          onClick={handleRetry}
          style={{
            padding: '8px 24px',
            borderRadius: '6px',
            border: 'none',
            background: '#1890ff',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (loadState === 'empty') {
    return <EmptyState title="请上传文档" description="支持 PDF/DOCX 格式" />;
  }

  return (
    <ErrorBoundary onRetry={handleRetry}>
      <div
        className="dual-column-layout"
        style={{
          display: 'flex',
          height: '100%',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* 左栏 — 原文 */}
        <div
          ref={leftRef}
          className="pane pane-left"
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'auto',
            borderRight: '1px solid #e8e8e8',
          }}
        >
          <canvas ref={leftCanvasRef} style={{ width: '100%' }} />
          <svg ref={leftSvgRef} className="svg-layer" style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }} />
          <div
            className="interaction-layer"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
            }}
          />
        </div>

        {/* 右栏 — 译文 */}
        <div
          ref={rightRef}
          className="pane pane-right"
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'auto',
          }}
        >
          <canvas ref={rightCanvasRef} style={{ width: '100%' }} />
          <svg ref={rightSvgRef} className="svg-layer" style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }} />
          <div
            className="interaction-layer"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
            }}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};

DualColumnLayout.displayName = 'DualColumnLayout';