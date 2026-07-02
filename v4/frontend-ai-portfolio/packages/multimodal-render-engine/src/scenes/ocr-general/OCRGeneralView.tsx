/**
 * OCR 通用识别 — 主视图组件
 *
 * 4 态加载：Loading → Loaded / Empty / Error
 * 集成 ImageRenderer + SVGLayer + TextResultPanel
 * 双向 hover 联动
 *
 * @module scenes/ocr-general/OCRGeneralView
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { EventBus } from '../../core/EventBus';
import { AnnotationStore } from '../../core/AnnotationStore';
import { ImageCoordAdapter } from '../../adapters/ImageCoordAdapter';
import { SVGLayer } from '../../layers/SVGLayer';
import { ImageRenderer } from '../../renderers/ImageRenderer';
import { TextResultPanel } from './TextResultPanel';
import { toast } from '../../components/Toast';
import { CATEGORY_COLOR } from '../../core/types';
import type { Annotation } from '../../core/types';

type LoadState = 'loading' | 'loaded' | 'empty' | 'error';

interface OCRGeneralViewProps {
  /** OCR 识别 API（可注入用于测试） */
  onRecognize?: (file: File) => Promise<Annotation[]>;
}

/**
 * OCR 通用识别组件
 */
export const OCRGeneralView: React.FC<OCRGeneralViewProps> = ({
  onRecognize,
}) => {
  const [loadState, setLoadState] = useState<LoadState>('empty');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [regions, setRegions] = useState<Annotation[]>([]);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const eventBusRef = useRef(new EventBus());
  const storeRef = useRef(new AnnotationStore(eventBusRef.current));
  const imageRendererRef = useRef<ImageRenderer | null>(null);
  const adapterRef = useRef<ImageCoordAdapter | null>(null);
  const svgLayerRef = useRef<SVGLayer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 初始化
  useEffect(() => {
    if (imageContainerRef.current && svgRef.current) {
      imageRendererRef.current = new ImageRenderer(imageContainerRef.current);
      svgLayerRef.current = new SVGLayer(svgRef.current);
    }

    // 订阅 hover 事件
    const unsub = eventBusRef.current.on(
      'ANNOTATION_HOVER',
      ({ id }) => setActiveId(id),
    );

    return () => {
      unsub();
      abortControllerRef.current?.abort();
      imageRendererRef.current?.destroy();
      adapterRef.current?.destroy();
      svgLayerRef.current?.clear();
    };
  }, []);

  // 选择文件
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.warning('请选择图片文件');
      return;
    }

    // 取消旧请求 + 清理旧标注
    abortControllerRef.current?.abort();
    storeRef.current.clear();
    svgLayerRef.current?.clear();
    setRegions([]);
    setActiveId(null);

    setLoadState('loading');

    try {
      // 渲染图片
      await imageRendererRef.current!.load(file);
      const imgEl = imageRendererRef.current!.getImgElement()!;

      // 创建适配器
      adapterRef.current = new ImageCoordAdapter(
        imgEl,
        imageContainerRef.current!,
      );

      // 调用 OCR API
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (!onRecognize) {
        setLoadState('loaded');
        return;
      }

      const results = await onRecognize(file);
      if (controller.signal.aborted) return;

      storeRef.current.load(results);
      setRegions(results);
      adapterRef.current.registerAnnotations(results);

      // 绘制识别框
      for (const region of results) {
        const rects = adapterRef.current.toScreenRects(region.position);
        for (const rect of rects) {
          svgLayerRef.current!.addAnnotationBox(region.id, rect, {
            strokeColor: CATEGORY_COLOR['ocr-region'],
            fillColor: 'rgba(19,194,194,0.08)',
            strokeWidth: 2,
          });
        }
      }

      setLoadState('loaded');
      toast.success(`识别完成，共 ${results.length} 个区域`);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setLoadState('error');
      toast.error('识别失败，请重试', {
        action: { label: '重试', onClick: () => fileInputRef.current?.click() },
      });
    }
  }, [onRecognize]);

  // hover 联动
  const handleImageHover = useCallback((e: React.MouseEvent) => {
    if (!adapterRef.current) return;
    const containerBCR = imageContainerRef.current!.getBoundingClientRect();
    const pt = { x: e.clientX - containerBCR.x, y: e.clientY - containerBCR.y };
    // 转换为绝对屏幕坐标
    const screenPt = { x: e.clientX, y: e.clientY };
    const id = adapterRef.current.hitTest(screenPt);
    eventBusRef.current.emit({ type: 'ANNOTATION_HOVER', id });
  }, []);

  const handlePanelHover = useCallback((id: string | null) => {
    if (id) {
      svgLayerRef.current?.setHighlight(id, true, 'hover');
    }
    setActiveId(id);
  }, []);

  // ---- 渲染 ----

  if (loadState === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100%', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <LoadingSkeleton variant="image" />
        </div>
        <LoadingSkeleton variant="text" width="320px" height="100%" rows={10} />
      </div>
    );
  }

  if (loadState === 'empty') {
    return (
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }}
        />
        <EmptyState
          title="请上传图片"
          description="支持 JPG / PNG / WebP 格式"
          action={{ label: '上传图片', onClick: () => fileInputRef.current?.click() }}
        />
      </div>
    );
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
      <div className="ocr-general-view" style={{ fontFamily: 'system-ui, sans-serif' }}>
        {/* 工具栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '6px 16px',
              borderRadius: '4px',
              border: '1px solid #d9d9d9',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            上传图片
          </button>
        </div>

        {/* 内容区 */}
        <div style={{ display: 'flex', height: 'calc(100% - 40px)' }}>
          {/* 图片面板 */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div
              ref={imageContainerRef}
              className="image-pane"
              style={{ width: '100%', height: '100%', overflow: 'auto' }}
            />
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
              onMouseMove={handleImageHover}
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

          {/* 结果面板 */}
          <TextResultPanel
            regions={regions}
            activeId={activeId}
            onHover={handlePanelHover}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};

OCRGeneralView.displayName = 'OCRGeneralView';