/**
 * OCR 自定义模板 — 主编辑器组件
 *
 * 整合 DrawTool + ResizeTool + ConfigPanel + TemplateManager。
 * beforeunload 拦截 + autoSave 30s 草稿。
 *
 * @module scenes/ocr-custom/TemplateEditor
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
import { DrawTool } from './DrawTool';
import { ConfigPanel } from './ConfigPanel';
import { TemplateManager } from './TemplateManager';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { toast } from '../../components/Toast';
import { calcResizedRect, calcMovedRect } from '../../utils/coord';
import type { FieldConfig, Annotation, Point } from '../../core/types';
import { CATEGORY_COLOR } from '../../core/types';

type LoadState = 'loading' | 'loaded' | 'empty';

/**
 * OCR 自定义模板编辑器
 */
export const TemplateEditor: React.FC = () => {
  const [loadState, setLoadState] = useState<LoadState>('empty');
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedRect, setSelectedRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const eventBusRef = useRef(new EventBus());
  const storeRef = useRef(new AnnotationStore(eventBusRef.current));
  const templateManagerRef = useRef(new TemplateManager());
  const imageRendererRef = useRef<ImageRenderer | null>(null);
  const adapterRef = useRef<ImageCoordAdapter | null>(null);
  const svgLayerRef = useRef<SVGLayer | null>(null);
  const drawToolRef = useRef<DrawTool | null>(null);

  // 草稿自动保存
  const { saveDraft, clearDraft } = useAutoSave(
    () => templateManagerRef.current.getFields(),
    hasUnsavedChanges,
  );

  // 键盘微调
  useKeyboardNav([
    {
      key: 'ArrowRight',
      handler: () => moveSelectedField(1, 0),
      description: '右移 1px',
    },
    {
      key: 'ArrowLeft',
      handler: () => moveSelectedField(-1, 0),
      description: '左移 1px',
    },
    {
      key: 'ArrowUp',
      handler: () => moveSelectedField(0, -1),
      description: '上移 1px',
    },
    {
      key: 'ArrowDown',
      handler: () => moveSelectedField(0, 1),
      description: '下移 1px',
    },
    {
      key: 'ArrowRight',
      shiftKey: true,
      handler: () => moveSelectedField(10, 0),
      description: '右移 10px',
    },
    {
      key: 'ArrowLeft',
      shiftKey: true,
      handler: () => moveSelectedField(-10, 0),
      description: '左移 10px',
    },
    {
      key: 'ArrowUp',
      shiftKey: true,
      handler: () => moveSelectedField(0, -10),
      description: '上移 10px',
    },
    {
      key: 'ArrowDown',
      shiftKey: true,
      handler: () => moveSelectedField(0, 10),
      description: '下移 10px',
    },
    {
      key: 'Escape',
      handler: () => {
        drawToolRef.current?.deactivate();
        setSelectedFieldId(null);
        setSelectedRect(null);
      },
      description: '取消选择',
    },
  ]);

  const moveSelectedField = useCallback((dx: number, dy: number) => {
    if (!selectedFieldId || !selectedRect) return;
    const newRect = calcMovedRect(selectedRect, { x: dx, y: dy });
    setSelectedRect(newRect);
    storeRef.current.update(selectedFieldId, {
      position: { kind: 'pixel', bbox: newRect },
    });
    setHasUnsavedChanges(true);
    adapterRef.current?.invalidate();
  }, [selectedFieldId, selectedRect]);

  // 初始化
  useEffect(() => {
    if (imageContainerRef.current && svgRef.current) {
      imageRendererRef.current = new ImageRenderer(imageContainerRef.current);
      svgLayerRef.current = new SVGLayer(svgRef.current);
      drawToolRef.current = new DrawTool(
        imageContainerRef.current,
        svgLayerRef.current,
      );
    }

    return () => {
      drawToolRef.current?.destroy();
      imageRendererRef.current?.destroy();
      adapterRef.current?.destroy();
      svgLayerRef.current?.clear();
    };
  }, []);

  // 上传图片
  const handleFileSelect = useCallback(async (file: File) => {
    setLoadState('loading');
    try {
      await imageRendererRef.current!.load(file);
      const imgEl = imageRendererRef.current!.getImgElement()!;
      adapterRef.current = new ImageCoordAdapter(imgEl, imageContainerRef.current!);
      setLoadState('loaded');
    } catch {
      setLoadState('empty');
      toast.error('图片加载失败');
    }
  }, []);

  // 画框
  const handleActivateDraw = useCallback(() => {
    drawToolRef.current?.activate(
      (rect) => {
        const tempId = `temp_${Date.now()}`;
        setSelectedFieldId(tempId);
        setSelectedRect(rect);
        setHasUnsavedChanges(true);
      },
      () => {
        // 取消
      },
    );
  }, []);

  // 点击图片区域
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (!adapterRef.current) return;

    const bcr = imageContainerRef.current!.getBoundingClientRect();
    const pt: Point = { x: e.clientX, y: e.clientY };
    const id = adapterRef.current.hitTest(pt);

    if (id) {
      const ann = storeRef.current.getById(id);
      if (ann && ann.position.kind === 'pixel') {
        setSelectedFieldId(id);
        setSelectedRect(ann.position.bbox);
        svgLayerRef.current?.showResizeHandles(id);
      }
    } else {
      setSelectedFieldId(null);
      setSelectedRect(null);
      svgLayerRef.current?.hideResizeHandles();
    }
  }, []);

  // 保存字段
  const handleSaveField = useCallback((config: Omit<FieldConfig, 'id'> & { id?: string }) => {
    const isNew = !config.id || config.id.startsWith('temp_');
    const fieldId = isNew ? `field_${Date.now()}` : config.id!;

    const fieldConfig: FieldConfig = {
      id: fieldId,
      label: config.label,
      dataType: config.dataType,
      required: config.required,
      regex: config.regex,
      description: config.description,
      order: config.order ?? templateManagerRef.current.getFields().length,
    };

    if (isNew) {
      templateManagerRef.current.addField(fieldConfig);
      const annotation: Annotation = {
        id: fieldId,
        type: 'ocr-field',
        position: { kind: 'pixel', bbox: selectedRect! },
        content: { original: config.label, fieldConfig },
        status: 'active',
      };
      storeRef.current.add(annotation);
      adapterRef.current?.registerAnnotations(storeRef.current.getAll());

      // 绘制标注框
      const rects = adapterRef.current!.toScreenRects({ kind: 'pixel', bbox: selectedRect! });
      for (const rect of rects) {
        svgLayerRef.current?.addAnnotationBox(fieldId, rect, {
          strokeColor: CATEGORY_COLOR['ocr-field'],
          fillColor: 'rgba(24,144,255,0.08)',
          strokeWidth: 2,
        });
        svgLayerRef.current?.addTextLabel(fieldId, rect, config.label);
      }
    } else {
      templateManagerRef.current.updateField(fieldId, fieldConfig);
      storeRef.current.update(fieldId, {
        content: { original: config.label, fieldConfig },
      });
      // 更新标签
      if (selectedRect) {
        const rects = adapterRef.current!.toScreenRects({ kind: 'pixel', bbox: selectedRect });
        for (const rect of rects) {
          svgLayerRef.current?.addTextLabel(fieldId, rect, config.label);
        }
      }
    }

    setSelectedFieldId(fieldId);
    setHasUnsavedChanges(true);
    saveDraft();
  }, [selectedRect]);

  // 删除字段
  const handleDeleteField = useCallback((fieldId: string) => {
    templateManagerRef.current.removeField(fieldId);
    storeRef.current.remove(fieldId);
    svgLayerRef.current?.remove(fieldId);
    setSelectedFieldId(null);
    setSelectedRect(null);
    setHasUnsavedChanges(true);
  }, []);

  // 保存模板
  const handleSaveTemplate = useCallback(() => {
    const name = prompt('模板名称：');
    if (!name) return;

    templateManagerRef.current.saveTemplate(name);
    clearDraft();
    setHasUnsavedChanges(false);
    toast.success('模板已保存');
  }, [clearDraft]);

  // ---- 渲染 ----

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
          title="请上传样本图片"
          description="支持 JPG / PNG 格式"
          action={{ label: '上传图片', onClick: () => fileInputRef.current?.click() }}
        />
      </div>
    );
  }

  if (loadState === 'loading') {
    return <LoadingSkeleton variant="image" />;
  }

  return (
    <ErrorBoundary>
      <div className="template-editor" style={{ fontFamily: 'system-ui, sans-serif', height: '100%' }}>
        {/* 工具栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '8px 16px',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <button
            onClick={() => { drawToolRef.current?.deactivate(); setSelectedFieldId(null); }}
            style={toolbarBtnStyle}
            title="选择"
          >
            🖱 选择
          </button>
          <button
            onClick={handleActivateDraw}
            style={toolbarBtnStyle}
            title="画框"
          >
            + 画框
          </button>
          <button
            onClick={() => {
              if (selectedFieldId) handleDeleteField(selectedFieldId);
            }}
            disabled={!selectedFieldId}
            style={{
              ...toolbarBtnStyle,
              opacity: selectedFieldId ? 1 : 0.4,
              cursor: selectedFieldId ? 'pointer' : 'not-allowed',
            }}
            title="删除"
          >
            🗑 删除
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleSaveTemplate}
            style={{
              ...toolbarBtnStyle,
              background: '#1890ff',
              color: '#fff',
              border: 'none',
            }}
          >
            保存模板
          </button>
        </div>

        {/* 编辑区 */}
        <div style={{ display: 'flex', height: 'calc(100% - 44px)' }}>
          {/* 图片面板 */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div
              ref={imageContainerRef}
              style={{ width: '100%', height: '100%', overflow: 'auto' }}
            />
            <svg
              ref={svgRef}
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
              onClick={handleImageClick}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 3,
              }}
            />
          </div>

          {/* 配置面板 */}
          <ConfigPanel
            fieldId={selectedFieldId}
            initialRect={selectedRect}
            initialConfig={
              selectedFieldId
                ? storeRef.current.getById(selectedFieldId)?.content.fieldConfig ?? null
                : null
            }
            onSave={handleSaveField}
            onDelete={handleDeleteField}
            onClose={() => {
              setSelectedFieldId(null);
              setSelectedRect(null);
              svgLayerRef.current?.hideResizeHandles();
            }}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};

TemplateEditor.displayName = 'TemplateEditor';

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: '4px',
  border: '1px solid #d9d9d9',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#333',
};