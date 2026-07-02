/**
 * OCRGeneralView — OCR 通用识别场景
 *
 * 三层渲染架构：
 *   Layer 1: <img>    原始图像（base layer）
 *   Layer 2: <canvas> 置信度热力图（Web Worker OffscreenCanvas）
 *   Layer 3: <svg>    TextOverlayLayer 文字覆盖 + 标注框（主交互层）
 *
 * 三档工具栏：框模式 / 文字模式（默认）/ 热力图模式
 */
import React, { useRef, useState, useCallback, useEffect } from 'react'
import { TextResultPanel } from './TextResultPanel'
import { TextOverlayLayer } from '../../layers/TextOverlayLayer'
import { ocrBlocksToTextBlocks } from './blockTypeMapping'
import { SpatialIndex } from '../../utils/rtree'
import type { Annotation, PixelPosition } from '../../core/types'
import type { PerfCollector } from '../../perf/PerfCollector'
import type { OcrBlock } from './blockTypeMapping'

// ─── Types ───────────────────────────────────────────────────────────────────

type DisplayMode = 'box' | 'text' | 'heatmap'

interface FileItem {
  id: string
  label: string
  thumb: string
  src: string
  naturalWidth: number
  naturalHeight: number
}

// ─── PDF Mock Generation ─────────────────────────────────────────────────────

const PDF_LINES: Array<Array<{ y: number; w: number; text: string }>> = [
  [
    { y: 100, w: 0.82, text: '摘要：多模态渲染引擎核心架构与实现方案' },
    { y: 140, w: 0.72, text: '1. 系统概述与技术选型分析' },
    { y: 175, w: 0.88, text: '2. 核心渲染管线：像素坐标到屏幕CSS坐标完整转换' },
    { y: 210, w: 0.64, text: '3. 空间索引优化：R-Tree 命中检测算法' },
    { y: 250, w: 0.78, text: '4. 事件驱动架构：EventBus 解耦设计模式' },
    { y: 285, w: 0.68, text: '5. ProseMirror 集成与 Decoration 插件实现' },
    { y: 340, w: 0.85, text: '6. 性能指标：1000个标注节点渲染耗时 < 16ms' },
    { y: 375, w: 0.58, text: '7. 内存占用分析与 GC 优化策略' },
    { y: 410, w: 0.75, text: '8. 多语言字符集处理（中日韩）' },
  ],
  [
    { y: 100, w: 0.80, text: '第二章：坐标系统设计' },
    { y: 140, w: 0.70, text: '2.1 三种坐标体系：像素 / 页面 / 字符偏移' },
    { y: 175, w: 0.90, text: '2.2 图片自然坐标与 CSS 显示坐标映射关系' },
    { y: 210, w: 0.65, text: '2.3 缩放比：offsetWidth / naturalWidth' },
    { y: 250, w: 0.75, text: '2.4 BCR 定位：imgEl.getBoundingClientRect()' },
    { y: 285, w: 0.82, text: '2.5 DrawTool 输出坐标转换到自然像素空间' },
    { y: 340, w: 0.68, text: '2.6 ResizeObserver 触发坐标重算机制' },
    { y: 375, w: 0.78, text: '2.7 PDF 页面坐标到视口坐标变换矩阵' },
    { y: 410, w: 0.60, text: '2.8 多页文档跨页坐标统一标准' },
  ],
  [
    { y: 100, w: 0.78, text: '第三章：性能优化与最佳实践' },
    { y: 140, w: 0.68, text: '3.1 React 状态驱动 vs 命令式 DOM 操作对比' },
    { y: 175, w: 0.86, text: '3.2 SVG 标注渲染：纯 React 元素 vs SVGLayer 类' },
    { y: 210, w: 0.62, text: '3.3 requestAnimationFrame 节流鼠标事件' },
    { y: 250, w: 0.76, text: '3.4 rbush 空间索引减少 O(n) 命中检测开销' },
    { y: 285, w: 0.84, text: '3.5 ProseMirror DecorationSet 增量更新策略' },
    { y: 340, w: 0.70, text: '3.6 Pointer Capture 拖拽不丢焦点方案' },
    { y: 375, w: 0.80, text: '3.7 CSS will-change 优化重绘性能' },
    { y: 410, w: 0.58, text: '3.8 虚拟列表优化大量标注渲染' },
  ],
]

function drawPDFPage(pageNum: number, totalPages: number): HTMLCanvasElement {
  const W = 595, H = 842
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#e0e0e0'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  ctx.fillStyle = '#f8f8f8'
  ctx.fillRect(0, 0, W, 68)
  ctx.strokeStyle = '#e8e8e8'
  ctx.beginPath(); ctx.moveTo(0, 68); ctx.lineTo(W, 68); ctx.stroke()

  ctx.fillStyle = '#333'
  ctx.font = 'bold 15px sans-serif'
  ctx.fillText(`技术文档  ·  第 ${pageNum} 页 / 共 ${totalPages} 页`, 40, 43)

  const lines = PDF_LINES[(pageNum - 1) % 3]
  lines.forEach(({ y, w, text }) => {
    const bw = W * w - 80
    ctx.fillStyle = '#f2f2f2'
    ctx.fillRect(40, y, bw, 26)
    ctx.fillStyle = '#444'
    ctx.font = '12px sans-serif'
    ctx.fillText(text, 47, y + 18, bw - 14)
  })

  ctx.fillStyle = '#bbb'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`— ${pageNum} —`, W / 2, H - 26)
  ctx.textAlign = 'left'

  return canvas
}

function makePDFItems(fileName: string, pages = 3): FileItem[] {
  return Array.from({ length: pages }, (_, i) => {
    const pageNum = i + 1
    const canvas = drawPDFPage(pageNum, pages)
    const src = canvas.toDataURL('image/png')
    const tc = document.createElement('canvas')
    tc.width = 100
    tc.height = Math.round(100 * 842 / 595)
    tc.getContext('2d')!.drawImage(canvas, 0, 0, tc.width, tc.height)
    return {
      id: `pdf-${fileName}-p${pageNum}-${Date.now()}`,
      label: `${fileName}  P.${pageNum}`,
      thumb: tc.toDataURL('image/jpeg', 0.7),
      src,
      naturalWidth: 595,
      naturalHeight: 842,
    }
  })
}

function loadImageItem(file: File): Promise<FileItem> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 100 / img.naturalWidth)
      const tc = document.createElement('canvas')
      tc.width = Math.round(img.naturalWidth * scale)
      tc.height = Math.round(img.naturalHeight * scale)
      tc.getContext('2d')!.drawImage(img, 0, 0, tc.width, tc.height)
      resolve({
        id: `img-${file.name}-${Date.now()}`,
        label: file.name,
        thumb: tc.toDataURL('image/jpeg', 0.7),
        src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      })
    }
    img.onerror = () => { URL.revokeObjectURL(src); reject() }
    img.src = src
  })
}

// ─── Mock OCR ────────────────────────────────────────────────────────────────

const OCR_STRUCTURED: OcrBlock[][] = [
  // Set 0: Invoice / 发票
  [
    { role:'title',     text:'增值税专用发票',             confidence:0.99, bbox:{x:0.10,y:0.02,w:0.80,h:0.07} },
    { role:'separator', text:'',                          confidence:1,    bbox:{x:0,y:0.10,w:1,h:0.005} },
    { role:'field',     label:'发票代码', text:'1100161430',      confidence:0.98, bbox:{x:0.03,y:0.12,w:0.45,h:0.07} },
    { role:'field',     label:'发票号码', text:'08765432',         confidence:0.97, bbox:{x:0.52,y:0.12,w:0.45,h:0.07} },
    { role:'field',     label:'开票日期', text:'2024年03月15日',    confidence:0.96, bbox:{x:0.03,y:0.22,w:0.94,h:0.07} },
    { role:'separator', text:'',                          confidence:1,    bbox:{x:0,y:0.30,w:1,h:0.005} },
    { role:'field',     label:'购买方名称', text:'北京某某科技有限公司',       confidence:0.97, bbox:{x:0.03,y:0.32,w:0.94,h:0.07} },
    { role:'field',     label:'销售方名称', text:'上海某供应链管理有限公司',     confidence:0.95, bbox:{x:0.03,y:0.42,w:0.94,h:0.07} },
    { role:'field',     label:'商品/服务名称', text:'软件开发服务',           confidence:0.99, bbox:{x:0.03,y:0.52,w:0.94,h:0.07} },
    { role:'separator', text:'',                          confidence:1,    bbox:{x:0,y:0.61,w:1,h:0.005} },
    { role:'field',     label:'不含税金额', text:'¥ 85,000.00',             confidence:0.98, bbox:{x:0.03,y:0.63,w:0.45,h:0.07} },
    { role:'field',     label:'税额',      text:'¥ 5,100.00',               confidence:0.97, bbox:{x:0.52,y:0.63,w:0.45,h:0.07} },
    { role:'separator', text:'',                          confidence:1,    bbox:{x:0,y:0.71,w:1,h:0.005} },
    { role:'field',     label:'价税合计(大写)', text:'捌万玖仟壹佰元整',       confidence:0.65, bbox:{x:0.03,y:0.73,w:0.94,h:0.07} },
    { role:'field',     label:'价税合计(小写)', text:'¥ 90,100.00',          confidence:0.98, bbox:{x:0.03,y:0.83,w:0.45,h:0.07} },
    { role:'field',     label:'备注',      text:'请妥善保管，遗失不补',        confidence:0.82, bbox:{x:0.52,y:0.83,w:0.45,h:0.07} },
  ],
  // Set 1: Technical document / 技术文档
  [
    { role:'title',    text:'多模态渲染引擎技术文档',                          confidence:0.99, bbox:{x:0.10,y:0.02,w:0.80,h:0.07} },
    { role:'subtitle', text:'第一章：系统架构概述',                            confidence:0.98, bbox:{x:0.03,y:0.11,w:0.60,h:0.06} },
    { role:'body',     text:'系统由坐标适配层、标注存储层、渲染展示层、交互事件层四个核心模块组成。', confidence:0.96, bbox:{x:0.03,y:0.19,w:0.94,h:0.07} },
    { role:'separator',text:'',                                              confidence:1,    bbox:{x:0,y:0.28,w:1,h:0.005} },
    { role:'subtitle', text:'第二章：坐标系统设计',                            confidence:0.97, bbox:{x:0.03,y:0.30,w:0.60,h:0.06} },
    { role:'field',    label:'像素坐标', text:'img.offsetWidth / img.naturalWidth', confidence:0.95, bbox:{x:0.03,y:0.38,w:0.94,h:0.07} },
    { role:'field',    label:'页面坐标', text:'页面 pt 单位，原点左下角',       confidence:0.94, bbox:{x:0.03,y:0.47,w:0.94,h:0.07} },
    { role:'field',    label:'字符偏移', text:'from / to 字符索引',            confidence:0.96, bbox:{x:0.03,y:0.56,w:0.94,h:0.07} },
    { role:'separator',text:'',                                              confidence:1,    bbox:{x:0,y:0.65,w:1,h:0.005} },
    { role:'subtitle', text:'第三章：性能优化',                                confidence:0.97, bbox:{x:0.03,y:0.67,w:0.60,h:0.06} },
    { role:'body',     text:'使用 R-Tree 空间索引将命中检测从 O(n) 降至 O(log n)，rAF 节流鼠标事件。', confidence:0.68, bbox:{x:0.03,y:0.75,w:0.94,h:0.07} },
    { role:'field',    label:'标注量',    text:'1000个节点，渲染帧率稳定 60fps',  confidence:0.93, bbox:{x:0.03,y:0.84,w:0.94,h:0.06} },
  ],
  // Set 2: PDF page — general article
  [
    { role:'title',    text:'第三章：性能优化与最佳实践',                        confidence:0.99, bbox:{x:0.07,y:0.08,w:0.86,h:0.06} },
    { role:'subtitle', text:'3.1 React 状态驱动 vs 命令式 DOM',                confidence:0.97, bbox:{x:0.07,y:0.17,w:0.70,h:0.05} },
    { role:'body',     text:'React 状态驱动依赖 diff 算法最小化 DOM 更新，适合标注量中等的场景；命令式操作可精确控制 DOM，但维护成本高。', confidence:0.95, bbox:{x:0.07,y:0.24,w:0.86,h:0.08} },
    { role:'subtitle', text:'3.2 requestAnimationFrame 节流',                  confidence:0.96, bbox:{x:0.07,y:0.35,w:0.70,h:0.05} },
    { role:'body',     text:'鼠标 mousemove 事件频率可达 300 次/秒，通过 rAF 节流可将实际处理次数降至 60 次/秒，显著减少 CPU 占用。', confidence:0.60, bbox:{x:0.07,y:0.42,w:0.86,h:0.08} },
    { role:'separator',text:'',                                                confidence:1,    bbox:{x:0,y:0.52,w:1,h:0.004} },
    { role:'subtitle', text:'3.3 Pointer Capture 拖拽方案',                    confidence:0.97, bbox:{x:0.07,y:0.54,w:0.70,h:0.05} },
    { role:'field',    label:'API',    text:'element.setPointerCapture(pointerId)', confidence:0.96, bbox:{x:0.07,y:0.61,w:0.86,h:0.06} },
    { role:'field',    label:'效果',   text:'拖拽超出元素边界仍可接收事件',      confidence:0.95, bbox:{x:0.07,y:0.69,w:0.86,h:0.06} },
    { role:'body',     text:'无需监听 window 上的事件，释放时自动清理，是拖拽场景的最佳实践。', confidence:0.78, bbox:{x:0.07,y:0.77,w:0.86,h:0.07} },
  ],
]

let _ocrRound = 0

function runMockOCR(nW: number, nH: number, itemId: string): { blocks: OcrBlock[]; annotations: Annotation[] } {
  const set = OCR_STRUCTURED[_ocrRound++ % OCR_STRUCTURED.length]
  const annotations: Annotation[] = set.map((block, i) => ({
    id: `${itemId}-r${i}`,
    type: 'ocr-region' as const,
    position: {
      kind: 'pixel' as const,
      bbox: {
        x: block.bbox.x * nW,
        y: block.bbox.y * nH,
        w: block.bbox.w * nW,
        h: block.bbox.h * nH,
      },
    },
    content: {
      original: block.text,
      confidence: block.confidence,
    },
    status: 'active' as const,
    meta: {
      role: block.role,
      label: block.label,
    },
  }))
  return { blocks: set, annotations }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface OCRGeneralViewProps {
  collector?: PerfCollector
}

export const OCRGeneralView: React.FC<OCRGeneralViewProps> = ({ collector }) => {
  const paneRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrCacheRef = useRef(new Map<string, { blocks: OcrBlock[]; annotations: Annotation[] }>())
  const layerRef = useRef<TextOverlayLayer | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const itemsLenRef = useRef(0)
  // R-Tree 空间索引（自然像素坐标系）
  const spatialIndexRef = useRef(new SpatialIndex())

  const [items, setItems] = useState<FileItem[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [activeBlocks, setActiveBlocks] = useState<OcrBlock[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [imgRect, setImgRect] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const [displayMode, setDisplayMode] = useState<DisplayMode>('text')

  itemsLenRef.current = items.length
  const activeItem = items[activeIdx] ?? null

  // ── Layer 初始化 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return
    layerRef.current = new TextOverlayLayer(svgRef.current)
    return () => { layerRef.current?.clear() }
  }, [])

  // ── 默认演示内容（首次挂载自动加载）────────────────────────────────────
  useEffect(() => {
    const defaultItems = makePDFItems('演示文档', 3)
    setItems(defaultItems)
  }, [])

  // ── 重建 R-Tree 索引（annotations 变化时）──────────────────────────────
  useEffect(() => {
    const items = annotations
      .filter(a => a.position.kind === 'pixel')
      .map(a => {
        const { x, y, w, h } = (a.position as PixelPosition).bbox
        return { id: a.id, rect: new DOMRect(x, y, w, h) }
      })
    spatialIndexRef.current.rebuild(items)
  }, [annotations])

  // ── Heatmap Worker 初始化 ─────────────────────────────────────────────────
  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../../pipeline/ConfidenceHeatmap.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'DONE' && heatmapCanvasRef.current) {
        const ctx = heatmapCanvasRef.current.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.drawImage(e.data.bitmap, 0, 0)
      }
    }
    return () => workerRef.current?.terminate()
  }, [])

  // ── 图像位置更新（ResizeObserver）────────────────────────────────────────
  const updateImgRect = useCallback(() => {
    const img = imgRef.current
    const pane = paneRef.current
    if (!img || !pane) return
    const ib = img.getBoundingClientRect()
    const pb = pane.getBoundingClientRect()
    setImgRect({ left: ib.left - pb.left, top: ib.top - pb.top, width: ib.width, height: ib.height })
  }, [])

  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const ro = new ResizeObserver(updateImgRect)
    ro.observe(pane)
    return () => ro.disconnect()
  }, [updateImgRect])

  // ── TextOverlayLayer 渲染（当 item / mode / imgRect 变化时）──────────────
  useEffect(() => {
    if (!layerRef.current || !activeItem || imgRect.width === 0 || activeBlocks.length === 0) return
    const scale = imgRect.width / activeItem.naturalWidth
    const textBlocks = ocrBlocksToTextBlocks(activeBlocks, activeItem.naturalWidth, activeItem.naturalHeight)

    const t0 = performance.now()
    // SVG 已 CSS 定位至 (imgRect.left, imgRect.top)，内部坐标系从 (0,0) 起算
    layerRef.current.render(textBlocks, scale, new DOMRect(0, 0, imgRect.width, imgRect.height))
    collector?.recordRender(performance.now() - t0)

    layerRef.current.setTextVisible(displayMode === 'text')
  }, [activeItem, activeBlocks, imgRect, displayMode, collector])

  // ── 热力图渲染（切换到 heatmap 模式时）───────────────────────────────────
  useEffect(() => {
    if (displayMode !== 'heatmap' || !activeBlocks.length || imgRect.width === 0) return
    if (!heatmapCanvasRef.current) return

    heatmapCanvasRef.current.width = imgRect.width
    heatmapCanvasRef.current.height = imgRect.height

    workerRef.current?.postMessage({
      type: 'RENDER',
      blocks: activeBlocks.map(b => ({
        bbox: b.bbox,
        confidence: b.confidence,
      })),
      width: imgRect.width,
      height: imgRect.height,
    })
  }, [displayMode, activeBlocks, imgRect])

  // ── OCR 加载（active item 切换时）────────────────────────────────────────
  useEffect(() => {
    const item = items[activeIdx]
    if (!item) { setAnnotations([]); setActiveBlocks([]); return }
    setActiveId(null)

    const cached = ocrCacheRef.current.get(item.id)
    if (cached) {
      setAnnotations(cached.annotations)
      setActiveBlocks(cached.blocks)
      collector?.setAnnotationCount(cached.annotations.length)
      return
    }

    setProcessing(true)
    const timer = window.setTimeout(() => {
      const t0 = performance.now()
      const result = runMockOCR(item.naturalWidth, item.naturalHeight, item.id)
      const renderMs = performance.now() - t0
      ocrCacheRef.current.set(item.id, result)
      setAnnotations(result.annotations)
      setActiveBlocks(result.blocks)
      setProcessing(false)
      collector?.recordRender(renderMs)
      collector?.setAnnotationCount(result.annotations.length)
    }, 350)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, items.length])

  // ── hover 联动 ────────────────────────────────────────────────────────────
  const handleHover = useCallback((id: string | null) => {
    setActiveId(id)
    if (layerRef.current) {
      const t0 = performance.now()
      layerRef.current.setActiveId(id)
      collector?.recordHitTest(performance.now() - t0)
    }
  }, [collector])

  // ── 文件处理 ──────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (fileArray: File[]) => {
    const startIdx = itemsLenRef.current
    const newItems: FileItem[] = []
    for (const file of fileArray) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        newItems.push(...makePDFItems(file.name, 3))
      } else if (file.type.startsWith('image/')) {
        try { newItems.push(await loadImageItem(file)) } catch { /* skip */ }
      }
    }
    if (newItems.length === 0) return
    setItems(prev => [...prev, ...newItems])
    setActiveIdx(startIdx)
  }, [])

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(annotations.map(a => a.content.original).join('\n'))
    } catch { /* no-op */ }
  }, [annotations])

  const scale = activeItem && imgRect.width > 0
    ? imgRect.width / activeItem.naturalWidth
    : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'sans-serif' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderBottom: '1px solid #f0f0f0',
        background: '#fff', flexShrink: 0,
      }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '6px 16px', background: '#1890ff', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
          }}
        >上传文件</button>

        {/* 三档显示模式 */}
        <div style={{ display: 'flex', border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden' }}>
          {(['box', 'text', 'heatmap'] as DisplayMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setDisplayMode(mode)}
              style={{
                padding: '5px 12px', border: 'none', cursor: 'pointer', fontSize: 12,
                background: displayMode === mode ? '#1890ff' : '#fff',
                color: displayMode === mode ? '#fff' : '#595959',
                borderRight: mode !== 'heatmap' ? '1px solid #d9d9d9' : 'none',
                transition: 'background .15s',
              }}
            >
              {mode === 'box' ? '框模式' : mode === 'text' ? '文字模式' : '热力图'}
            </button>
          ))}
        </div>

        {processing && <span style={{ fontSize: 13, color: '#1890ff' }}>识别中...</span>}
        {!processing && annotations.length > 0 && (
          <span style={{ fontSize: 13, color: '#52c41a' }}>
            识别完成 · {annotations.length} 个区域
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#bbb' }}>
          支持 JPG / PNG / WEBP / PDF
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const files = e.target.files
            if (files && files.length > 0) handleFiles(Array.from(files))
            e.target.value = ''
          }}
        />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left sidebar: thumbnail list */}
        {items.length > 0 && (
          <div style={{
            flexShrink: 0, width: 132, overflowY: 'auto',
            borderRight: '1px solid #f0f0f0', background: '#fafafa',
          }}>
            {items.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => setActiveIdx(idx)}
                title={item.label}
                style={{
                  padding: '8px 6px', cursor: 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  background: idx === activeIdx ? '#e8f4ff' : '#fff',
                  borderLeft: idx === activeIdx ? '3px solid #1890ff' : '3px solid transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  transition: 'background 0.15s',
                }}
              >
                <img
                  src={item.thumb}
                  alt={item.label}
                  style={{
                    width: 100, height: 'auto', maxHeight: 120,
                    objectFit: 'contain', display: 'block',
                    border: `1px solid ${idx === activeIdx ? '#91caff' : '#e8e8e8'}`,
                    borderRadius: 2, background: '#fff',
                  }}
                />
                <div style={{
                  fontSize: 11, color: idx === activeIdx ? '#1890ff' : '#777',
                  lineHeight: 1.3, textAlign: 'center', width: 112,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Image pane — 三层叠加容器 */}
        <div
          ref={paneRef}
          onDrop={e => {
            e.preventDefault(); setIsDragging(false)
            handleFiles(Array.from(e.dataTransfer.files))
          }}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          style={{
            flex: 1, position: 'relative', overflow: 'hidden',
            background: isDragging ? 'rgba(24,144,255,0.04)' : '#f0f0f0',
            outline: isDragging ? '2px dashed #1890ff' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {activeItem ? (
            <>
              {/* Layer 1: 原始图像 */}
              <img
                ref={imgRef}
                key={activeItem.id}
                src={activeItem.src}
                alt={activeItem.label}
                onLoad={updateImgRect}
                style={{
                  display: 'block', maxWidth: '100%', maxHeight: '100%',
                  objectFit: 'contain', userSelect: 'none', pointerEvents: 'none',
                }}
              />

              {/* Layer 2: 置信度热力图 Canvas */}
              <canvas
                ref={heatmapCanvasRef}
                style={{
                  position: 'absolute',
                  left: imgRect.left,
                  top: imgRect.top,
                  width: imgRect.width,
                  height: imgRect.height,
                  pointerEvents: 'none',
                  opacity: displayMode === 'heatmap' ? 1 : 0,
                  transition: 'opacity 0.25s',
                }}
              />

              {/* Layer 3: SVG 文字覆盖层 + 交互 */}
              <svg
                ref={svgRef}
                style={{
                  position: 'absolute',
                  left: imgRect.left,
                  top: imgRect.top,
                  width: imgRect.width,
                  height: imgRect.height,
                  overflow: 'visible',
                  opacity: displayMode === 'heatmap' ? 0.35 : 1,
                  transition: 'opacity 0.25s',
                }}
                onMouseMove={e => {
                  if (!imgRef.current || !activeItem) return
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
                  // 转换到自然像素坐标系（与 R-Tree 索引一致）
                  const px = (e.clientX - rect.left) / scale
                  const py = (e.clientY - rect.top) / scale

                  // R-Tree 空间索引命中检测（O(log n)）
                  const t0 = performance.now()
                  const hitId = spatialIndexRef.current.hitTest({ x: px, y: py })
                  collector?.recordHitTest(performance.now() - t0)

                  handleHover(hitId)
                }}
                onMouseLeave={() => handleHover(null)}
              />
            </>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 12, color: '#bbb', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 52 }}>🖼️</div>
              <div style={{ fontSize: 14 }}>点击或拖拽文件到此处</div>
              <div style={{ fontSize: 12 }}>支持 JPG / PNG / WEBP / PDF</div>
            </div>
          )}
        </div>

        {/* Result panel */}
        <div style={{ flexShrink: 0, width: 300, overflow: 'hidden' }}>
          <TextResultPanel
            regions={annotations}
            activeId={activeId}
            onHover={id => handleHover(id)}
            onCopyAll={handleCopyAll}
          />
        </div>
      </div>
    </div>
  )
}
