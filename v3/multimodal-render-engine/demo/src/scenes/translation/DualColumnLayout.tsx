import React, {
  useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo,
} from 'react'
import { ParagraphMapper } from './ParagraphMapper'
import { ScrollSyncBridge } from './ScrollSyncBridge'
import type { ParagraphMapping } from '../../core/types'

// ──────────────────── Types ────────────────────

type BlockType = 'h1' | 'h2' | 'para' | 'bullet' | 'code' | 'quote'

/** 译文段落审校状态机：4态 */
type SegmentStatus = 'pending' | 'confirmed' | 'modified' | 'flagged'

interface Segment {
  id: string
  index: number
  type: BlockType
  srcText: string
  tgtText: string
  /** 0–1, AI 翻译置信度，驱动透明度编码 */
  confidence: number
  level?: number
}

// ──────────────────── Data ────────────────────

/** 置信度数组 — 刻意引入几个低置信度段落演示透明度编码 */
const CONF: number[] = [
  0.98, 0.97,       // h1, h2
  0.72, 0.91,       // para: 系统架构描述（中等偏低）
  0.96,             // h2
  0.88, 0.95, 0.93, 0.90, 0.97, 0.99,  // para + bullets + code
  0.95,             // h2
  0.89, 0.92, 0.63, 0.85,  // para + quote（quote 置信低）
  0.94,             // h2
  0.71, 0.99, 0.87, // para（低置信）+ code + para
  0.96,             // h2
  0.83, 0.96, 0.61, 0.92, 0.88, 0.77, 0.99,  // bullets
  0.94,             // h2
  0.69, 0.83,       // para（低置信）+ para
]

const SEGMENTS: Segment[] = [
  { id:'seg-0',  index:0,  type:'h1',    confidence: CONF[0],
    srcText:'多模态渲染引擎技术文档',
    tgtText:'Multimodal Rendering Engine — Technical Documentation' },
  { id:'seg-1',  index:1,  type:'h2',    confidence: CONF[1],
    srcText:'第一章：系统架构概述',
    tgtText:'Chapter 1: System Architecture Overview' },
  { id:'seg-2',  index:2,  type:'para',  confidence: CONF[2],
    srcText:'多模态渲染引擎是一种将 AI 模型结构化输出精准叠加到原始内容上的核心组件。它需要统一处理图像像素坐标、文档页面坐标、文本字符偏移等多种坐标系，并在渲染层做正确的转换与对齐。',
    tgtText:'The multimodal rendering engine is a core component that precisely overlays structured AI model outputs onto original content. It must uniformly handle multiple coordinate systems — image pixel coordinates, document page coordinates, and text character offsets — performing correct transformations and alignment at the rendering layer. This architecture enables the engine to act as a universal overlay layer, accepting annotation streams from diverse AI services — object detection, OCR, NLP — and faithfully projecting their spatial and semantic metadata onto the raw content, regardless of the underlying medium or data format.' },
  { id:'seg-3',  index:3,  type:'para',  confidence: CONF[3],
    srcText:'系统由四个核心模块组成：坐标适配层（CoordAdapter）、标注存储层（AnnotationStore）、渲染展示层（RenderLayer）和交互事件层（InteractionBus）。各模块通过事件总线解耦，保持高内聚低耦合。',
    tgtText:'The system comprises four core modules: a Coordinate Adaptation Layer (CoordAdapter), an Annotation Storage Layer (AnnotationStore), a Rendering Layer (RenderLayer), and an Interaction Event Layer (InteractionBus). Modules are decoupled through an event bus, maintaining high cohesion and low coupling.' },
  { id:'seg-4',  index:4,  type:'h2',    confidence: CONF[4],
    srcText:'第二章：坐标系统设计',
    tgtText:'Chapter 2: Coordinate System Design' },
  { id:'seg-5',  index:5,  type:'para',  confidence: CONF[5],
    srcText:'本引擎支持三种坐标体系：像素坐标系（图片自然像素）、页面坐标系（PDF 页面 pt 单位）和字符偏移坐标系（文本起止索引）。不同场景使用不同坐标系，需通过适配器完成相互转换。',
    tgtText:'The engine supports three coordinate systems: the pixel coordinate system (image natural pixels), the page coordinate system (PDF page pt units), and the character offset coordinate system (text start/end indices). Different scenarios use different systems, with adapters performing mutual conversions.' },
  { id:'seg-6',  index:6,  type:'bullet', confidence: CONF[6], level:1,
    srcText:'像素坐标系：适用于扫描件、照片等位图内容。以图片左上角为原点，单位为自然像素。',
    tgtText:'Pixel coordinate system: For bitmapped content such as scans and photos. Origin at image top-left, unit is natural pixels.' },
  { id:'seg-7',  index:7,  type:'bullet', confidence: CONF[7], level:1,
    srcText:'页面坐标系：适用于 PDF 文档。以页面左下角为原点，单位为 pt（1/72 英寸）。',
    tgtText:'Page coordinate system: For PDF documents. Origin at page bottom-left, unit is pt (1/72 inch).' },
  { id:'seg-8',  index:8,  type:'bullet', confidence: CONF[8], level:1,
    srcText:'字符偏移坐标系：适用于富文本编辑器。以字符流的起止 index 表示范围。',
    tgtText:'Character offset coordinate system: For rich text editors. Range expressed as start/end character indices.' },
  { id:'seg-9',  index:9,  type:'para',  confidence: CONF[9],
    srcText:'坐标转换的关键公式为：屏幕坐标 = 自然像素坐标 × 缩放比。其中缩放比 = img.offsetWidth / img.naturalWidth。使用 img 元素本身的 getBoundingClientRect() 而非容器的 BCR，可以正确处理 margin/padding 带来的偏移。',
    tgtText:"The key conversion formula is: screen coordinate = natural pixel coordinate × scale factor, where scale = img.offsetWidth / img.naturalWidth. Using the img element's own getBoundingClientRect() rather than the container's BCR correctly handles offsets introduced by margin/padding." },
  { id:'seg-10', index:10, type:'code',  confidence: CONF[10],
    srcText:'const scale = img.offsetWidth / img.naturalWidth\nconst screenX = bcr.x + naturalX * scale\nconst screenY = bcr.y + naturalY * scale',
    tgtText:'const scale = img.offsetWidth / img.naturalWidth\nconst screenX = bcr.x + naturalX * scale\nconst screenY = bcr.y + naturalY * scale' },
  { id:'seg-11', index:11, type:'h2',    confidence: CONF[11],
    srcText:'第三章：标注存储与事件总线',
    tgtText:'Chapter 3: Annotation Store and Event Bus' },
  { id:'seg-12', index:12, type:'para',  confidence: CONF[12],
    srcText:'AnnotationStore 以 Map<string, Annotation> 结构管理所有标注数据，提供增删改查及状态变更接口。每次状态变更都会通过 EventBus 广播相应事件，下游模块订阅并响应。',
    tgtText:'AnnotationStore manages all annotation data in a Map<string, Annotation> structure, providing CRUD and state-change interfaces. Every state change broadcasts a corresponding event via EventBus, which downstream modules subscribe to and respond accordingly.' },
  { id:'seg-13', index:13, type:'quote', confidence: CONF[13],
    srcText:'设计原则：标注数据是单一事实来源（Single Source of Truth）。渲染层、交互层均从 Store 读取状态，禁止各自维护副本。',
    tgtText:'Design principle: Annotation data is the Single Source of Truth. Rendering and interaction layers read state from the Store; maintaining local copies is prohibited.' },
  { id:'seg-14', index:14, type:'para',  confidence: CONF[14],
    srcText:'EventBus 定义了 13 种内核事件类型，涵盖 ANNOTATION_HOVER、ANNOTATION_SELECT、ANNOTATION_ACCEPT、SCROLL_TO 等。所有事件均携带强类型负载，在 TypeScript 层面保证消费方正确处理。',
    tgtText:'EventBus defines 13 kernel event types, covering ANNOTATION_HOVER, ANNOTATION_SELECT, ANNOTATION_ACCEPT, SCROLL_TO, and others. All events carry strongly-typed payloads, ensuring correct handling by consumers at the TypeScript level.' },
  { id:'seg-15', index:15, type:'para',  confidence: CONF[15],
    srcText:'通过事件总线解耦各模块，使得每个模块可以独立开发、测试和替换，极大降低了系统整体的维护成本。',
    tgtText:'Decoupling modules through the event bus allows each module to be independently developed, tested, and replaced, greatly reducing overall system maintenance costs.' },
  { id:'seg-16', index:16, type:'h2',    confidence: CONF[16],
    srcText:'第四章：空间索引与命中检测',
    tgtText:'Chapter 4: Spatial Index and Hit Testing' },
  { id:'seg-17', index:17, type:'para',  confidence: CONF[17],
    srcText:'对于图像场景，命中检测需要在鼠标坐标与所有标注框之间做碰撞测试。朴素的 O(n) 遍历在标注量大时性能不佳，因此引擎集成了基于 R-Tree 的空间索引（rbush 库），将命中检测降至 O(log n)。',
    tgtText:"For image scenes, hit testing requires collision checks between mouse coordinates and all annotation boxes. Naive O(n) traversal performs poorly with large annotation counts, so the engine integrates an R-Tree spatial index (rbush library), reducing hit testing to O(log n). While linear scan is acceptable for small sets (under 50 entries), production systems frequently annotate entire document pages with hundreds of bounding boxes. The R-Tree's ability to prune large subtrees during spatial queries makes it the industry-standard choice for interactive, real-time annotation interfaces requiring sub-millisecond hover detection." },
  { id:'seg-18', index:18, type:'code',  confidence: CONF[18],
    srcText:'// 构建空间索引\nindex.rebuild(annotations.map(a => ({\n  id: a.id,\n  rect: toScreenDOMRect(a.position)\n})))\n\n// 命中测试\nconst hit = index.hitTest({ x: mouseX, y: mouseY })',
    tgtText:'// Build spatial index\nindex.rebuild(annotations.map(a => ({\n  id: a.id,\n  rect: toScreenDOMRect(a.position)\n})))\n\n// Hit test\nconst hit = index.hitTest({ x: mouseX, y: mouseY })' },
  { id:'seg-19', index:19, type:'para',  confidence: CONF[19],
    srcText:'R-Tree 的特点是对矩形区域查询做了专项优化。当用户移动鼠标时，以鼠标坐标为查询点，R-Tree 可在微秒级时间内返回所有与该点相交的标注框，再从中选取面积最小的一个作为命中结果。',
    tgtText:'R-Tree is specially optimized for rectangular region queries. When the user moves the mouse, R-Tree returns all annotation boxes intersecting the mouse point in microseconds, then the smallest-area result is selected as the hit target.' },
  { id:'seg-20', index:20, type:'h2',    confidence: CONF[20],
    srcText:'第五章：ProseMirror 文本标注',
    tgtText:'Chapter 5: ProseMirror Text Annotation' },
  { id:'seg-21', index:21, type:'para',  confidence: CONF[21],
    srcText:'对于富文本场景，引擎集成了 ProseMirror 编辑器。文本校对结果以字符偏移坐标存储，通过 Decoration.inline 接口在编辑器内渲染波浪线下划线，实现不侵入文档数据的标注展示。',
    tgtText:'For rich-text scenarios, the engine integrates the ProseMirror editor. Proofreading results are stored as character-offset coordinates and rendered as wavy underline decorations via the Decoration.inline interface, achieving non-invasive annotation display without modifying document data.' },
  { id:'seg-22', index:22, type:'bullet', confidence: CONF[22], level:1,
    srcText:'DecorationPlugin：监听 AnnotationStore 变更，重建 DecorationSet 并触发视图更新。',
    tgtText:'DecorationPlugin: Listens for AnnotationStore changes, rebuilds DecorationSet, and triggers view updates.' },
  { id:'seg-23', index:23, type:'bullet', confidence: CONF[23], level:1,
    srcText:'wavyPathD：使用二次贝塞尔曲线生成波浪线 SVG 路径，振幅 1.5px，波长 5px。',
    tgtText:'wavyPathD: Generates wavy SVG paths using quadratic Bézier curves, amplitude 1.5px, wavelength 5px.' },
  { id:'seg-24', index:24, type:'bullet', confidence: CONF[24], level:1,
    srcText:'ErrorPanel：右侧错误列表，按错误类型分 Tab，与编辑器双向悬停联动。',
    tgtText:'ErrorPanel: Right-side error list, tabbed by error type, with bidirectional hover linkage to the editor.' },
  { id:'seg-25', index:25, type:'para',  confidence: CONF[25],
    srcText:'Decoration 方案的关键优势在于不修改底层 ProseMirror 文档数据，标注与文档完全解耦，支持实时增删标注而不触发文档历史记录。',
    tgtText:'The key advantage of the Decoration approach is that it does not modify the underlying ProseMirror document data, fully decoupling annotations from the document and supporting real-time addition/removal without triggering document history.' },
  { id:'seg-26', index:26, type:'h2',    confidence: CONF[26],
    srcText:'第六章：性能优化策略',
    tgtText:'Chapter 6: Performance Optimization' },
  { id:'seg-27', index:27, type:'para',  confidence: CONF[27],
    srcText:'渲染性能的关键在于减少不必要的 DOM 操作和重排。引擎采用 requestAnimationFrame 节流鼠标事件回调，每帧最多处理一次命中检测；ResizeObserver 在容器尺寸变化时触发坐标重算，而非每帧轮询。',
    tgtText:'Rendering performance hinges on minimizing unnecessary DOM operations and reflows. The engine throttles mouse event callbacks with requestAnimationFrame, processing at most one hit test per frame; ResizeObserver triggers coordinate recalculation on container resize rather than polling each frame. The RAF-based throttle is especially critical on high-DPI retina displays where the browser fires mousemove events at up to 120 Hz — without throttling, a single mouse gesture across a densely annotated image could trigger hundreds of redundant hit-test computations per second, degrading the experience noticeably.' },
  { id:'seg-28', index:28, type:'quote', confidence: CONF[28],
    srcText:'实测数据：在 1000 个标注框场景下，鼠标移动事件处理帧率稳定在 60fps；切换标注高亮状态耗时 < 2ms（Chrome 115，MacBook Pro M2）。',
    tgtText:'Benchmark: In a 1000-annotation scenario, mouse-move event processing maintains 60fps; toggling annotation highlight state takes < 2ms (Chrome 115, MacBook Pro M2).' },
  { id:'seg-29', index:29, type:'para',  confidence: CONF[29],
    srcText:'翻译双栏视图通过 ScrollSyncBridge 实现两侧滚动同步。核心原理：当左侧滚动时，计算当前可见段落在全文中的相对位置，再将右侧滚动到对应映射段落的位置。使用互斥锁防止循环触发。',
    tgtText:'The dual-column translation view synchronizes scrolling through ScrollSyncBridge. The core principle: when the left side scrolls, compute the relative position of the currently visible paragraph within the full text, then scroll the right side to the position of the corresponding mapped paragraph. A mutex prevents circular triggering.' },
]

/** 1:1 段落映射，用于 ParagraphMapper 二分查找 */
const MAPPINGS: ParagraphMapping[] = SEGMENTS.map(s => ({
  sourceId: s.id,
  targetId: s.id,
  confidence: s.confidence,
}))

// ──────────────────── Style helpers ────────────────────

const STATUS_COLOR: Record<SegmentStatus, string> = {
  pending:   '#d9d9d9',
  confirmed: '#52c41a',
  modified:  '#1890ff',
  flagged:   '#fa8c16',
}

const STATUS_LABEL: Record<SegmentStatus, string> = {
  pending:   '待审',
  confirmed: '已确认',
  modified:  '已修改',
  flagged:   '标注',
}

function confidenceBadge(c: number): { bg: string; color: string; text: string } {
  if (c >= 0.9)  return { bg: '#f6ffed', color: '#389e0d', text: `${Math.round(c * 100)}%` }
  if (c >= 0.75) return { bg: '#fffbe6', color: '#d48806', text: `${Math.round(c * 100)}%` }
  return             { bg: '#fff2e8', color: '#d4380d', text: `${Math.round(c * 100)}%` }
}

// ──────────────────── SegmentCell ────────────────────

function SegmentCell({
  seg, side, status, active, onClick,
}: {
  seg: Segment
  side: 'src' | 'tgt'
  status: SegmentStatus
  active: boolean
  onClick: () => void
}) {
  const isTgt = side === 'tgt'

  /**
   * 低置信度译文 opacity 编码
   * confidence 0.6 → opacity 0.55; 0.99 → opacity 1.0
   * 对应简历中 "globalAlpha 0.3-0.7 透明度编码"
   */
  const textOpacity = isTgt ? Math.max(0.35, seg.confidence) : 1

  const activeBorder = side === 'src' ? '#1890ff' : '#52c41a'
  const statusBorder  = STATUS_COLOR[status]

  const base: React.CSSProperties = {
    padding:    seg.type === 'h2' ? '12px 16px 10px' : '8px 16px',
    marginBottom: 1,
    borderLeft: `3px solid ${active ? activeBorder : statusBorder}`,
    background: active
      ? (side === 'src' ? '#e6f7ff' : '#f6ffed')
      : status === 'flagged' ? '#fff7e6' : 'transparent',
    transition: 'background .15s, border-color .15s, opacity .2s',
    cursor: 'pointer',
    outline: active ? `2px solid ${activeBorder}22` : 'none',
    outlineOffset: -1,
    position: 'relative',
  }

  if (seg.type === 'code') {
    base.fontFamily  = "'SF Mono', 'Fira Code', 'Courier New', monospace"
    base.fontSize    = 12
    base.lineHeight  = 1.7
    base.background  = active ? '#fff8dc' : '#f5f5f5'
    base.whiteSpace  = 'pre'
    base.overflowX   = 'auto'
  }
  if (seg.type === 'quote') {
    base.fontStyle = 'italic'
    base.fontSize  = 13
    base.color     = '#595959'
  }
  if (seg.type === 'h2') {
    base.fontSize   = 15
    base.fontWeight = 700
    base.color      = '#262626'
    base.background = active ? '#dbeeff' : '#f5f9ff'
    base.borderLeft = `3px solid ${active ? '#096dd9' : '#adc6ff'}`
    base.marginBottom = 2
  }

  const badge = isTgt ? confidenceBadge(seg.confidence) : null

  return (
    <div data-para-id={seg.id} style={base} onClick={onClick}>

      {/* Top-right badges (tgt column only) */}
      {isTgt && (
        <span style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* Confidence badge — always shown */}
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 8,
            background: badge!.bg, color: badge!.color,
            border: `1px solid ${badge!.color}44`,
            lineHeight: 1.5,
          }}>
            {badge!.text}
          </span>
          {/* Status badge */}
          {status !== 'pending' && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 8,
              background: `${STATUS_COLOR[status]}22`,
              color: STATUS_COLOR[status],
              border: `1px solid ${STATUS_COLOR[status]}66`,
              lineHeight: 1.5,
            }}>
              {STATUS_LABEL[status]}
            </span>
          )}
        </span>
      )}

      {/* Content */}
      <span style={{
        fontSize: seg.type === 'h2' ? 15 : 13.5,
        lineHeight: seg.type === 'h2' ? 1.5 : 1.8,
        opacity: textOpacity,
        display: seg.type === 'bullet' ? 'flex' : 'block',
        alignItems: 'flex-start',
        paddingRight: isTgt ? 64 : 0,   // avoid badge overlap
      }}>
        {seg.type === 'bullet' && (
          <span style={{
            display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
            background: '#1890ff', marginRight: 8, marginTop: 7, flexShrink: 0,
          }} />
        )}
        {(seg.type === 'para' || seg.type === 'quote') && (
          <span style={{ color: '#bbb', fontSize: 10, marginRight: 5, userSelect: 'none' }}>
            ¶{seg.index + 1}
          </span>
        )}
        {side === 'src' ? seg.srcText : seg.tgtText}
      </span>
    </div>
  )
}

// ──────────────────── Progress bar ────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : (value / max) * 100
  return (
    <div style={{
      width: 120, height: 5, borderRadius: 3,
      background: '#e8e8e8', overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: pct === 100 ? '#52c41a' : '#1890ff',
        transition: 'width .3s ease',
        borderRadius: 3,
      }} />
    </div>
  )
}

// ──────────────────── Main component ────────────────────

export function DualColumnLayout() {
  /** 段落审校状态机 — Map 作为单一数据源 */
  const [statuses, setStatuses] = useState<Map<string, SegmentStatus>>(
    () => new Map(SEGMENTS.map(s => [s.id, 'pending']))
  )
  /** 当前键盘焦点段落 */
  const [activeId, setActiveId] = useState<string | null>(null)
  /** 悬停段落（纯视觉） */
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // 两个独立滚动容器 — ScrollSyncBridge 需要分别操控两侧 scrollTop
  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  // 避免 keyboard handler 中的 stale closure
  const activeIdRef   = useRef<string | null>(null)
  const statusesRef   = useRef(statuses)
  activeIdRef.current = activeId
  statusesRef.current = statuses

  // 持有 Bridge 实例便于 cleanup
  const bridgeRef = useRef<ScrollSyncBridge | null>(null)
  // ParagraphMapper 单例，复用 buildAlignMap
  const mapperRef = useRef(new ParagraphMapper())

  // ── Computed ──

  const confirmedCount = useMemo(
    () => [...statuses.values()].filter(s => s === 'confirmed' || s === 'modified').length,
    [statuses]
  )
  const flaggedCount = useMemo(
    () => [...statuses.values()].filter(s => s === 'flagged').length,
    [statuses]
  )
  const pendingCount = SEGMENTS.length - confirmedCount - flaggedCount

  // ── Status mutation helpers ──

  const setStatus = useCallback((id: string, next: SegmentStatus) => {
    setStatuses(prev => new Map(prev).set(id, next))
  }, [])

  const confirmSegment = useCallback((id: string) => {
    setStatus(id, 'confirmed')
  }, [setStatus])

  const toggleFlag = useCallback((id: string) => {
    setStatuses(prev => {
      const cur = prev.get(id) ?? 'pending'
      return new Map(prev).set(id, cur === 'flagged' ? 'pending' : 'flagged')
    })
  }, [])

  // ── Keyboard workflow ──
  // Ctrl+Enter → confirm active; F → flag/unflag; ↑↓ → navigate
  // useRef avoids stale closure while keeping effect deps stable

  const scrollSegmentIntoView = useCallback((id: string) => {
    const leftEl  = leftRef.current?.querySelector(`[data-para-id="${id}"]`)  as HTMLElement | null
    const rightEl = rightRef.current?.querySelector(`[data-para-id="${id}"]`) as HTMLElement | null
    leftEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    rightEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const navigateActive = useCallback((dir: 1 | -1) => {
    const cur = activeIdRef.current
    if (!cur) { const first = SEGMENTS[0]; if (first) { setActiveId(first.id); scrollSegmentIntoView(first.id) }; return }
    const idx = SEGMENTS.findIndex(s => s.id === cur)
    const next = SEGMENTS[idx + dir]
    if (next) { setActiveId(next.id); scrollSegmentIntoView(next.id) }
  }, [scrollSegmentIntoView])

  const confirmActive = useCallback(() => {
    const id = activeIdRef.current
    if (!id) return
    confirmSegment(id)
    // Advance focus to next pending/flagged segment
    const idx = SEGMENTS.findIndex(s => s.id === id)
    const next = SEGMENTS.slice(idx + 1).find(s => {
      const st = statusesRef.current.get(s.id)
      return st === 'pending' || st === 'flagged'
    })
    if (next) { setActiveId(next.id); scrollSegmentIntoView(next.id) }
  }, [confirmSegment, scrollSegmentIntoView])

  const flagActive = useCallback(() => {
    const id = activeIdRef.current
    if (!id) return
    toggleFlag(id)
  }, [toggleFlag])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); confirmActive() }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flagActive() }
      else if (e.key === 'ArrowDown')  { e.preventDefault(); navigateActive(1) }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); navigateActive(-1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [confirmActive, flagActive, navigateActive])

  // ── ScrollSyncBridge 初始化 ──
  // useLayoutEffect: DOM 已挂载但浏览器未 paint，可安全读取 offsetTop
  useLayoutEffect(() => {
    const left  = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    // 构建段落对齐映射表（queryAll [data-para-id] → offsetTop）
    mapperRef.current.buildAlignMap([], [], MAPPINGS, left, right)

    const bridge = new ScrollSyncBridge(left, right, mapperRef.current)
    bridge.attach()
    bridgeRef.current = bridge

    return () => {
      bridge.detach()
      bridgeRef.current = null
    }
  }, [])  // 仅 mount/unmount

  // ── ResizeObserver：容器尺寸变化时重建对齐表 ──
  // 段落高度随宽度变化，offsetTop 会整体移位，必须重算
  useEffect(() => {
    const left  = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const ro = new ResizeObserver(() => {
      mapperRef.current.buildAlignMap([], [], MAPPINGS, left, right)
    })
    ro.observe(left)
    ro.observe(right)
    return () => ro.disconnect()
  }, [])

  // ── Render ──

  const activeStatus = activeId ? statuses.get(activeId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'sans-serif' }}>

      {/* ── Header: 进度 + 状态 ── */}
      <div style={{
        padding: '8px 16px', borderBottom: '1px solid #e8e8e8', background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>翻译审校</span>
          <span style={{
            fontSize: 11, background: '#e6f7ff', color: '#1890ff',
            padding: '2px 8px', borderRadius: 10,
          }}>
            {SEGMENTS.length} 段
          </span>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'center' }}>
          <ProgressBar value={confirmedCount} max={SEGMENTS.length} />
          <span style={{ fontSize: 11, color: '#595959', whiteSpace: 'nowrap' }}>
            已确认 <strong style={{ color: '#1890ff' }}>{confirmedCount}</strong>/{SEGMENTS.length}
          </span>
          {flaggedCount > 0 && (
            <span style={{
              fontSize: 11, background: '#fff7e6', color: '#d46b08',
              padding: '1px 7px', borderRadius: 8,
              border: '1px solid #ffd591',
            }}>
              ⚑ 待处理 {flaggedCount}
            </span>
          )}
          {pendingCount > 0 && (
            <span style={{ fontSize: 11, color: '#8c8c8c' }}>
              待审 {pendingCount}
            </span>
          )}
        </div>

        {/* Confidence legend */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: '#8c8c8c' }}>
          <span>置信度</span>
          {[['#389e0d', '≥90%'], ['#d48806', '75–90%'], ['#d4380d', '<75%']].map(([c, t]) => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c as string }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ── Column labels ── */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #e8e8e8', background: '#fafafa', flexShrink: 0,
      }}>
        <div style={{
          flex: 1, padding: '5px 16px', fontSize: 12, fontWeight: 600, color: '#595959',
          borderRight: '1px solid #e8e8e8',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          原文（中文）
          <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400 }}>点击段落 / ↑↓ 切换</span>
        </div>
        <div style={{
          flex: 1, padding: '5px 16px', fontSize: 12, fontWeight: 600, color: '#595959',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          译文（英文）
          <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400 }}>透明度 = 置信度</span>
        </div>
      </div>

      {/* ── Dual independent scroll columns ── */}
      {/* 各自独立滚动 — ScrollSyncBridge 监听双侧 scroll 事件，
          通过 ParagraphMapper.lookupByScrollTop 二分查找对齐段落后同步另一侧 scrollTop */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: 原文 */}
        <div
          ref={leftRef}
          style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #e8e8e8' }}
        >
          {SEGMENTS.map(seg => (
            <SegmentCell
              key={seg.id}
              seg={seg}
              side="src"
              status={statuses.get(seg.id)!}
              active={seg.id === activeId || seg.id === hoveredId}
              onClick={() => setActiveId(seg.id)}
            />
          ))}
          <div style={{ height: 24 }} />
        </div>

        {/* Right: 译文 */}
        <div
          ref={rightRef}
          style={{ flex: 1, overflowY: 'auto' }}
          onMouseLeave={() => setHoveredId(null)}
        >
          {SEGMENTS.map(seg => (
            <div
              key={seg.id}
              onMouseEnter={() => setHoveredId(seg.id)}
            >
              <SegmentCell
                seg={seg}
                side="tgt"
                status={statuses.get(seg.id)!}
                active={seg.id === activeId || seg.id === hoveredId}
                onClick={() => setActiveId(seg.id)}
              />
            </div>
          ))}
          <div style={{ height: 24 }} />
        </div>
      </div>

      {/* ── Footer: 键盘快捷键 + 当前段状态 ── */}
      <div style={{
        padding: '5px 14px', borderTop: '1px solid #f0f0f0', background: '#fafafa',
        fontSize: 11, color: '#8c8c8c', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> 切换段落</span>
          <span><Kbd>Ctrl+Enter</Kbd> 确认</span>
          <span><Kbd>F</Kbd> 标注/取消标注</span>
        </div>
        {activeId && activeStatus && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: STATUS_COLOR[activeStatus],
            }} />
            <span style={{ color: '#595959' }}>
              当前段 · {STATUS_LABEL[activeStatus]}
              {(() => {
                const seg = SEGMENTS.find(s => s.id === activeId)
                return seg ? ` · 置信度 ${Math.round(seg.confidence * 100)}%` : ''
              })()}
            </span>
          </span>
        )}
        {!activeId && (
          <span style={{ color: '#bbb' }}>滚动双栏已通过 ScrollSyncBridge 同步</span>
        )}
      </div>
    </div>
  )
}

// ── Keyboard key badge ──
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: 'inline-block', padding: '1px 5px', borderRadius: 3,
      background: '#f5f5f5', border: '1px solid #d9d9d9',
      fontSize: 10, fontFamily: 'inherit', color: '#595959',
      lineHeight: 1.6, marginRight: 2,
    }}>
      {children}
    </kbd>
  )
}
