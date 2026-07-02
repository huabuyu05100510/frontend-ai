import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { loadPdfjs, PDFJS_CMAP_URL, PDFJS_STD_FONTS_URL } from '../../renderers/pdf/pdfjsLoader'
import { exportPdf } from '../../renderers/pdf/exportPdf'
import { toScreen, toPdf } from '../../renderers/pdf/anchor'
import type { Viewport, ScreenRect } from '../../renderers/pdf/anchor'
import { createAnnotation, annotationPage } from '../../renderers/pdf/AnnotationModel'
import type { Annotation, AnnotationSpec, Pt } from '../../renderers/pdf/AnnotationModel'
import { CollabDoc } from '../../collab/CollabDoc'
import type { CollabUpdate } from '../../collab/CollabDoc'
import { CollabClient } from '../../collab/CollabClient'

type Tool = 'select' | 'highlight' | 'rect' | 'ink' | 'note'
type Size = { width: number; height: number }

const COLORS = ['#ffd400', '#ff5151', '#2f81f7', '#3fb950', '#000000']
const COLLAB_URL = (import.meta as any).env?.VITE_COLLAB_URL || 'ws://localhost:8787'

export function PdfEditor({ source }: { source: SourceHandle }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [baseSizes, setBaseSizes] = useState<Size[]>([])
  const [scale, setScale] = useState(1.2)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState(COLORS[0])
  const [annots, setAnnots] = useState<Annotation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [collabStatus, setCollabStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')

  const pdfRef = useRef<any>(null)
  const bytesRef = useRef<ArrayBuffer | null>(null)
  // 每个标签页一个唯一 clientId，保证 CRDT 决胜与协同区分
  const clientId = useRef('u_' + Math.random().toString(36).slice(2, 8))
  const collabRef = useRef<CollabDoc<Annotation> | null>(null)
  // lazy init：首次渲染时初始化，StrictMode 双调用安全（同一 ref）
  if (!collabRef.current) collabRef.current = new CollabDoc<Annotation>(clientId.current)
  const clientRef = useRef<CollabClient<Annotation> | null>(null)
  const undoStack = useRef<Array<{ kind: 'add' | 'remove'; ann: Annotation }>>([])
  const redoStack = useRef<Array<{ kind: 'add' | 'remove'; ann: Annotation }>>([])

  // collabRef 是稳定的 ref，不需要作为依赖
  const refresh = useCallback(() => {
    setAnnots(collabRef.current!.entries().map(([, v]) => v))
  }, [])

  const broadcast = useCallback((u: CollabUpdate<Annotation>) => {
    clientRef.current?.send(u)
  }, [])

  // 协同连接：source 或 refresh 变化时重建（refresh 依赖为空，仅 source 变化触发）
  useEffect(() => {
    const client = new CollabClient<Annotation>(collabRef.current!, {
      url: COLLAB_URL,
      room: 'pdf:' + (source.name || 'default'),
      onChange: refresh,
      onStatus: setCollabStatus,
    })
    clientRef.current = client
    client.connect()
    return () => client.close()
  }, [source, refresh])

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const buf = await source.blob().arrayBuffer()
        bytesRef.current = buf
        const pdfjs = await loadPdfjs()
        const doc = await pdfjs.getDocument({
          data: buf.slice(0),
          cMapUrl: PDFJS_CMAP_URL,
          cMapPacked: true,
          standardFontDataUrl: PDFJS_STD_FONTS_URL,
        }).promise
        if (disposed) return
        pdfRef.current = doc
        const sizes: Size[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const vp = page.getViewport({ scale: 1 })
          sizes.push({ width: vp.width, height: vp.height })
        }
        if (disposed) return
        setBaseSizes(sizes)
        setStatus('ready')
      } catch (e) {
        if (!disposed) {
          setErr(String(e))
          setStatus('error')
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [source])

  const addAnnotation = useCallback(
    (spec: AnnotationSpec) => {
      const ann = createAnnotation(spec, { author: clientId.current })
      const u = collabRef.current!.set(ann.id, ann)
      broadcast(u)
      undoStack.current.push({ kind: 'add', ann })
      redoStack.current = []
      refresh()
      setSelected(ann.id)
    },
    [refresh, broadcast],
  )

  const removeAnnotation = useCallback(
    (id: string) => {
      const ann = collabRef.current!.get(id)
      if (!ann) return
      const u = collabRef.current!.delete(id)
      broadcast(u)
      undoStack.current.push({ kind: 'remove', ann })
      redoStack.current = []
      refresh()
      setSelected(null)
    },
    [refresh, broadcast],
  )

  const undo = useCallback(() => {
    const act = undoStack.current.pop()
    if (!act) return
    const u = act.kind === 'add' ? collabRef.current!.delete(act.ann.id) : collabRef.current!.set(act.ann.id, act.ann)
    broadcast(u)
    redoStack.current.push(act)
    refresh()
  }, [refresh, broadcast])

  const redo = useCallback(() => {
    const act = redoStack.current.pop()
    if (!act) return
    const u = act.kind === 'add' ? collabRef.current!.set(act.ann.id, act.ann) : collabRef.current!.delete(act.ann.id)
    broadcast(u)
    undoStack.current.push(act)
    refresh()
  }, [refresh, broadcast])

  // 模拟协作者（CRDT 合并 + 广播到其他端）
  const simulateCollaborator = useCallback(() => {
    const bob = new CollabDoc<Annotation>('bob')
    const ann = createAnnotation(
      { type: 'note', rect: { page: 0, x: 0.5, y: 0.1, w: 0.3, h: 0.05 }, text: 'Bob：这里需复核' },
      { author: 'bob' },
    )
    const u = bob.set(ann.id, ann)
    collabRef.current!.applyUpdate(u) // 本地合并
    broadcast(u) // 广播给其他端
    refresh()
  }, [refresh, broadcast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) removeAnnotation(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, selected, removeAnnotation])

  const doExport = useCallback(async () => {
    if (!bytesRef.current) return
    try {
      const blob = await exportPdf(bytesRef.current.slice(0), annots)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (source.name.replace(/\.pdf$/i, '') || 'document') + '.annotated.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      alert('导出失败：' + String(e))
    }
  }, [annots, source.name])

  if (status === 'error') {
    // CDN 不可达兜底：退回浏览器只读查看器，保证不白屏
    const url = URL.createObjectURL(source.blob().slice(0, source.size, 'application/pdf'))
    return (
      <div>
        <div className="kv" style={{ color: 'var(--yellow)' }}>
          PDF.js 渲染内核加载失败（CDN 不可达）：{err}。已降级为只读查看器；联网或接入本地依赖后即恢复编辑能力。
        </div>
        <iframe title="pdf" src={url} style={{ width: '100%', height: 540, border: 'none', borderRadius: 8 }} />
      </div>
    )
  }

  return (
    <div>
      <div className="panel" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <div className="row" style={{ alignItems: 'center' }}>
          {(['select', 'highlight', 'rect', 'ink', 'note'] as Tool[]).map((t) => (
            <button key={t} onClick={() => setTool(t)} style={{ borderColor: t === tool ? 'var(--accent)' : undefined }}>
              {{ select: '选择', highlight: '高亮', rect: '矩形', ink: '手绘', note: '便签' }[t]}
            </button>
          ))}
          <span style={{ width: 8 }} />
          {COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 18,
                height: 18,
                background: c,
                borderRadius: 4,
                cursor: 'pointer',
                outline: c === color ? '2px solid #fff' : '1px solid #444',
              }}
            />
          ))}
          <span style={{ width: 8 }} />
          <button onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}>－</button>
          <span className="kv">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(4, s + 0.2))}>＋</button>
          <span style={{ width: 8 }} />
          <button onClick={undo}>↶ 撤销</button>
          <button onClick={redo}>↷ 重做</button>
          <button onClick={simulateCollaborator}>👥 模拟协作者</button>
          <button onClick={doExport} style={{ borderColor: 'var(--green)' }}>⬇ 导出带批注 PDF</button>
        </div>
        <div className="kv" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            title={`协同：${collabStatus}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: collabStatus === 'open' ? 'var(--green)' : collabStatus === 'connecting' ? 'var(--yellow)' : '#777',
            }}
          />
          <span>
            协同{collabStatus === 'open' ? '已连接' : collabStatus === 'connecting' ? '连接中' : '离线（编辑仍可用，重连后自动合并）'}
          </span>
          <span>·</span>
          <span>
            {status === 'loading'
              ? '加载 PDF.js 渲染内核…'
              : `${baseSizes.length} 页 · 批注 ${annots.length} 个 · 高亮=划词选中文字`}
          </span>
        </div>
      </div>

      <div className="viewport" style={{ height: 600, padding: 16 }}>
        <PageList
          baseSizes={baseSizes}
          scale={scale}
          tool={tool}
          color={color}
          pdfRef={pdfRef}
          annots={annots}
          selected={selected}
          onSelect={setSelected}
          onCommit={addAnnotation}
        />
      </div>
    </div>
  )
}

// PageList 独立组件：useMemo 按页分组 annotations，稳定引用避免 PageView 无效重绘
function PageList({
  baseSizes, scale, tool, color, pdfRef, annots, selected, onSelect, onCommit,
}: {
  baseSizes: Size[]
  scale: number
  tool: Tool
  color: string
  pdfRef: React.MutableRefObject<any>
  annots: Annotation[]
  selected: string | null
  onSelect: (id: string | null) => void
  onCommit: (spec: AnnotationSpec) => void
}) {
  const pageAnnots = useMemo(
    () => baseSizes.map((_, i) => annots.filter((a) => annotationPage(a) === i)),
    [annots, baseSizes],
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {baseSizes.map((sz, i) => (
        <PageView
          key={i}
          index={i}
          base={sz}
          scale={scale}
          tool={tool}
          color={color}
          pdfRef={pdfRef}
          annotations={pageAnnots[i]}
          selected={selected}
          onSelect={onSelect}
          onCommit={onCommit}
        />
      ))}
    </div>
  )
}

interface PageViewProps {
  index: number
  base: Size
  scale: number
  tool: Tool
  color: string
  pdfRef: React.MutableRefObject<any>
  annotations: Annotation[]
  selected: string | null
  onSelect: (id: string | null) => void
  onCommit: (spec: AnnotationSpec) => void
}

const PageView = memo(function PageView({ index, base, scale, tool, color, pdfRef, annotations, selected, onSelect, onCommit }: PageViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<any>(null)
  const [visible, setVisible] = useState(false)
  const [drag, setDrag] = useState<ScreenRect | null>(null)
  const [inkPts, setInkPts] = useState<Pt[]>([])

  const W = base.width * scale
  const H = base.height * scale
  const vp: Viewport = { width: W, height: H, scale, rotation: 0 }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)), {
      rootMargin: '300px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let textLayer: any = null
    ;(async () => {
      const pdf = pdfRef.current
      const canvas = canvasRef.current
      if (!pdf || !canvas) return
      try {
        const page = await pdf.getPage(index + 1)
        if (cancelled) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: scale * dpr })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${W}px`
        canvas.style.height = `${H}px`
        renderTaskRef.current?.cancel?.()
        const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport })
        renderTaskRef.current = task
        await task.promise

        // 文本层：透明 DOM <span> 精确贴合字形 → 可框选/复制（行业三层架构的关键一层）
        const textDiv = textRef.current
        if (textDiv && !cancelled) {
          const pdfjs = await loadPdfjs()
          textDiv.innerHTML = ''
          textDiv.style.width = `${W}px`
          textDiv.style.height = `${H}px`
          textDiv.style.setProperty('--scale-factor', String(scale))
          const textViewport = page.getViewport({ scale }) // CSS px（不含 dpr）
          const textContent = await page.getTextContent()
          if (cancelled) return
          if (pdfjs.TextLayer) {
            textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: textDiv, viewport: textViewport })
            await textLayer.render()
          } else if (pdfjs.renderTextLayer) {
            await pdfjs.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport: textViewport }).promise
          }
          // 严格模式/重渲染竞态：若已取消则清空，避免叠加出现重影
          if (cancelled) textDiv.innerHTML = ''
        }
      } catch {
        /* render cancelled */
      }
    })()
    return () => {
      cancelled = true
      try {
        textLayer?.cancel?.()
      } catch {
        /* noop */
      }
      if (textRef.current) textRef.current.innerHTML = ''
    }
  }, [visible, scale, index, W, H, pdfRef])

  const local = (e: React.PointerEvent): Pt => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: React.PointerEvent) => {
    const p = local(e)
    if (tool === 'select') {
      const norm = toPdf({ x: p.x, y: p.y, w: 0, h: 0 }, vp, index)
      const hit = [...annotations].reverse().find((a) => {
        const b = a.type === 'ink' ? null : a.rect
        return b && norm.x >= b.x && norm.x <= b.x + b.w && norm.y >= b.y && norm.y <= b.y + b.h
      })
      onSelect(hit?.id ?? null)
      return
    }
    if (tool === 'note') {
      const text = prompt('便签内容：')
      if (text) {
        const r = toPdf({ x: p.x, y: p.y, w: 0.0, h: 0.0 }, vp, index)
        onCommit({ type: 'note', rect: { ...r, w: 0.25, h: 0.04 }, text })
      }
      return
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (tool === 'ink') setInkPts([{ x: p.x / W, y: p.y / H }])
    else setDrag({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onMove = (e: React.PointerEvent) => {
    const p = local(e)
    if (tool === 'ink' && inkPts.length) setInkPts((pts) => [...pts, { x: p.x / W, y: p.y / H }])
    else if (drag) setDrag({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) })
  }

  const onUp = () => {
    if (tool === 'ink' && inkPts.length > 1) {
      onCommit({ type: 'ink', page: index, points: inkPts, color, width: 2 })
      setInkPts([])
    } else if (drag && drag.w > 3 && drag.h > 3 && tool === 'rect') {
      onCommit({ type: 'rect', rect: toPdf(drag, vp, index), color })
    }
    setDrag(null)
    setInkPts([])
  }

  // 划词高亮（Acrobat/飞书式）：读取文本层选区的字形矩形，逐行贴合生成高亮
  const commitTextHighlight = () => {
    const sel = window.getSelection()
    const wrap = wrapRef.current
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !wrap) return
    const wr = wrap.getBoundingClientRect()
    let made = false
    for (const r of sel.getRangeAt(0).getClientRects()) {
      if (r.width < 2 || r.height < 2) continue
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (cx < wr.left || cx > wr.right || cy < wr.top || cy > wr.bottom) continue // 仅取本页
      const rect = toPdf({ x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height }, vp, index)
      onCommit({ type: 'highlight', rect, color })
      made = true
    }
    if (made) sel.removeAllRanges()
  }

  // 文本层在「选择 / 高亮」下可交互（可划词）；其余工具让 SVG 接管绘制
  const textInteractive = tool === 'select' || tool === 'highlight'

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: W, height: H, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.4)' }}
      onMouseUp={tool === 'highlight' ? commitTextHighlight : undefined}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
      <div
        ref={textRef}
        className="textLayer"
        style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: textInteractive ? 'auto' : 'none' }}
      />
      <svg
        width={W}
        height={H}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          cursor: tool === 'rect' || tool === 'ink' || tool === 'note' ? 'crosshair' : 'default',
          // 选择/高亮让出指针给文本层（可划词）；单个注解仍可点选（见 AnnotShape）
          pointerEvents: textInteractive ? 'none' : 'auto',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {annotations.map((a) => (
          <AnnotShape key={a.id} a={a} vp={vp} selected={a.id === selected} onSelect={() => onSelect(a.id)} />
        ))}
        {drag && tool === 'rect' && (
          <rect x={drag.x} y={drag.y} width={drag.w} height={drag.h} fill="none" fillOpacity={0.35} stroke={color} />
        )}
        {tool === 'ink' && inkPts.length > 1 && (
          <polyline points={inkPts.map((p) => `${p.x * W},${p.y * H}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />
        )}
      </svg>
      <span style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 11, color: '#999' }}>{index + 1}</span>
    </div>
  )
})

function AnnotShape({ a, vp, selected, onSelect }: { a: Annotation; vp: Viewport; selected: boolean; onSelect: () => void }) {
  const stroke = selected ? '#2f81f7' : 'transparent'
  // 即使 svg 根在选择模式 pointerEvents:none，单个注解仍可点选（用于删除/移动）
  const hit = { pointerEvents: 'auto' as const, cursor: 'pointer' }
  if (a.type === 'ink') {
    const pts = a.points.map((p) => `${p.x * vp.width},${p.y * vp.height}`).join(' ')
    return (
      <polyline
        points={pts}
        fill="none"
        stroke={a.color}
        strokeWidth={a.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={hit}
        onPointerDown={onSelect}
      />
    )
  }
  const s = toScreen(a.rect, vp)
  if (a.type === 'highlight')
    return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={a.color} fillOpacity={0.35} stroke={stroke} strokeDasharray="4" style={hit} onPointerDown={onSelect} />
  if (a.type === 'rect')
    return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke={selected ? '#2f81f7' : a.color} strokeWidth={1.5} style={hit} onPointerDown={onSelect} />
  if (a.type === 'redact') return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#000" style={hit} onPointerDown={onSelect} />
  // note
  return (
    <g style={hit} onPointerDown={onSelect}>
      <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#fff3b0" stroke={selected ? '#2f81f7' : '#e0c000'} rx={3} />
      <text x={s.x + 6} y={s.y + s.h / 2 + 4} fontSize={12} fill="#5a4a00">
        {a.text.length > 18 ? a.text.slice(0, 17) + '…' : a.text}
      </text>
    </g>
  )
}
