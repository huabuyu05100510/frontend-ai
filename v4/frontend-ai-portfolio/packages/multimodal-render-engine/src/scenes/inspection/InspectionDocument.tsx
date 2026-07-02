/**
 * 文档智检场景
 *
 * 复用 pdfium-wasm DocumentRenderer，在 Canvas 之上叠加 SVG 波浪线标注。
 * 支持 scroll-to-error、zoom 重建坐标、错误面板联动。
 *
 * @module scenes/inspection/InspectionDocument
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { EventBus } from '../../core/EventBus';
import { AnnotationStore } from '../../core/AnnotationStore';
import { DocumentCoordAdapter } from '../../adapters/DocumentCoordAdapter';
import { SVGLayer } from '../../layers/SVGLayer';
import { ErrorPanel } from './ErrorPanel';
import { useAnnotationSync } from '../../hooks/useAnnotationSync';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { toast } from '../../components/Toast';
import { CATEGORY_COLOR } from '../../core/types';
import type { Annotation } from '../../core/types';

type LoadState = 'loading' | 'loaded' | 'empty' | 'error';

interface InspectionDocumentProps {
  /** 文档文件 */
  file?: File;
  /** 智检 API（可注入用于测试） */
  inspectAPI?: (file: File) => Promise<Annotation[]>;
}

/**
 * 文档智检组件
 */
export const InspectionDocument: React.FC<InspectionDocumentProps> = ({
  file,
  inspectAPI,
}) => {
  const [loadState, setLoadState] = useState<LoadState>(
    file ? 'loading' : 'empty',
  );

  const docContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const eventBusRef = useRef(new EventBus());
  const storeRef = useRef(new AnnotationStore(eventBusRef.current));
  const adapterRef = useRef<DocumentCoordAdapter | null>(null);
  const svgLayerRef = useRef<SVGLayer | null>(null);

  const { annotations, activeId, focusNext, focusPrev } = useAnnotationSync(
    storeRef.current,
    eventBusRef.current,
  );

  // 键盘快捷键
  useKeyboardNav([
    { key: 'F8', handler: focusNext, description: '下一个错误' },
    { key: 'F8', shiftKey: true, handler: focusPrev, description: '上一个错误' },
  ]);

  // 初始化
  useEffect(() => {
    if (svgRef.current) {
      svgLayerRef.current = new SVGLayer(svgRef.current);
    }

    return () => {
      adapterRef.current?.destroy();
      svgLayerRef.current?.clear();
      eventBusRef.current.clear();
    };
  }, []);

  // 加载文件 + 调用智检 API
  useEffect(() => {
    if (!file || !inspectAPI) return;

    const loadFile = async () => {
      setLoadState('loading');
      try {
        const results = await inspectAPI(file);
        storeRef.current.load(results);

        // TODO: 集成 pdfium-wasm Worker 渲染文档页面
        // 当前为骨架实现，实际使用时需要初始化 DocumentCoordAdapter

        setLoadState('loaded');
      } catch (error) {
        setLoadState('error');
        toast.error('文档加载失败');
      }
    };

    loadFile();
  }, [file, inspectAPI]);

  // 绘制错误标注
  const renderErrorAnnotations = useCallback(() => {
    if (!adapterRef.current || !svgLayerRef.current) return;

    svgLayerRef.current.clear();

    for (const ann of annotations) {
      const rects = adapterRef.current.toScreenRects(ann.position);
      const color = CATEGORY_COLOR[ann.type];
      if (ann.status === 'ignored') {
        svgLayerRef.current.addWavyUnderline(ann.id, rects, '#d9d9d9');
      } else {
        svgLayerRef.current.addWavyUnderline(ann.id, rects, color);
      }
    }
  }, [annotations]);

  useEffect(() => {
    renderErrorAnnotations();
  }, [renderErrorAnnotations]);

  // hover 检测
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!adapterRef.current) return;
    const pt = { x: e.clientX, y: e.clientY };
    const id = adapterRef.current.hitTest(pt);
    eventBusRef.current.emit({ type: 'ANNOTATION_HOVER', id });
  }, []);

  const handleAccept = useCallback((id: string) => {
    storeRef.current.setStatus(id, 'accepted');
    svgLayerRef.current?.remove(id);
    toast.success('已接受建议');
  }, []);

  const handleIgnore = useCallback((id: string) => {
    storeRef.current.setStatus(id, 'ignored');
    renderErrorAnnotations();
  }, [renderErrorAnnotations]);

  const handleFocus = useCallback((id: string) => {
    eventBusRef.current.emit({ type: 'SCROLL_TO', annotationId: id });
    eventBusRef.current.emit({ type: 'ANNOTATION_SELECT', id });
  }, []);

  // ---- 渲染 ----

  if (loadState === 'empty') {
    return (
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              // 触发父组件重新渲染
            }
            e.target.value = '';
          }}
        />
        <EmptyState
          title="请上传文档"
          description="支持 PDF / DOCX 格式"
          action={{ label: '上传文档', onClick: () => fileInputRef.current?.click() }}
        />
      </div>
    );
  }

  if (loadState === 'loading') {
    return <LoadingSkeleton variant="canvas" />;
  }

  if (loadState === 'error') {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <button
          onClick={() => fileInputRef.current?.click()}
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

  return (
    <ErrorBoundary>
      <div style={{
        display: 'flex',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* 文档区域 */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div
            ref={docContainerRef}
            className="document-pane"
            style={{
              width: '100%',
              height: '100%',
              overflow: 'auto',
              position: 'relative',
            }}
          >
            {/* Canvas 页面由 pdfium-wasm Worker 渲染 */}
            <canvas style={{ width: '100%' }} />
          </div>

          <svg
            ref={svgRef}
            className="svg-layer"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          />

          <div
            className="interaction-layer"
            onMouseMove={handleMouseMove}
            onMouseLeave={() =>
              eventBusRef.current.emit({ type: 'ANNOTATION_HOVER', id: null })
            }
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
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

InspectionDocument.displayName = 'InspectionDocument';