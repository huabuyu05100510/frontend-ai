import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { indexToCol, loadXlsx, type SheetModel, DEFAULT_COL_W, DEFAULT_ROW_H } from '../../ooxml/xlsx'
import { loadDocx, type Block, type Run } from '../../ooxml/docx'
import { loadPptx, type Slide } from '../../ooxml/pptx'
import type { OoxmlWorkerResponse } from '../../ooxml/ooxml.worker'
import { CumulativeIndex } from '../../pipeline/CumulativeIndex'
import { VirtualList } from '../VirtualList'
import {
  extractDocxUnits,
  extractSheetUnits,
  extractSlideUnits,
  translateAll,
} from '../../translation/translate'
import { OfficePdfView } from './OfficePdfView'

type Loaded =
  | { kind: 'docx'; blocks: Block[] }
  | { kind: 'sheet'; sheet: SheetModel }
  | { kind: 'pptx'; slides: Slide[] }

export type Mode = 'source' | 'both' | 'target'

const SLIDE_W = 720

export function OfficeView({ source, realType }: { source: SourceHandle; realType: string }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [trans, setTrans] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Mode>('source')
  const [err, setErr] = useState<string | null>(null)
  const [hifi, setHifi] = useState(true)

  useEffect(() => {
    let off = false
    let worker: Worker | null = null
    setData(null)
    setErr(null)

    // 解析结果回填（含翻译单元抽取）
    const apply = (result: Block[] | SheetModel | Slide[]) => {
      if (off) return
      if (realType === 'docx') {
        const blocks = result as Block[]
        setData({ kind: 'docx', blocks })
        setTrans(translateAll(extractDocxUnits(blocks)))
      } else if (realType === 'xlsx') {
        const sheet = result as SheetModel
        setData({ kind: 'sheet', sheet })
        setTrans(translateAll(extractSheetUnits(sheet)))
      } else if (realType === 'pptx') {
        const slides = result as Slide[]
        setData({ kind: 'pptx', slides })
        setTrans(translateAll(extractSlideUnits(slides)))
      }
    }

    // 小文件主线程直接解析（首屏瞬时，省去 Worker 启动 + 消息往返）；
    // 大文件（>2MB）才离开主线程，避免阻塞滚动/交互。
    const MAIN_THREAD_MAX = 25 * 1024 * 1024

    source.blob().arrayBuffer().then(async (buf) => {
      if (off) return
      if (buf.byteLength <= MAIN_THREAD_MAX) {
        const bytes = new Uint8Array(buf)
        const result =
          realType === 'docx' ? await loadDocx(bytes)
          : realType === 'xlsx' ? await loadXlsx(bytes)
          : await loadPptx(bytes)
        apply(result as Block[] | SheetModel | Slide[])
        return
      }
      worker = new Worker(new URL('../../ooxml/ooxml.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<OoxmlWorkerResponse>) => {
        worker?.terminate()
        if (off) return
        if (!e.data.ok) { setErr(e.data.error); return }
        apply(e.data.result as Block[] | SheetModel | Slide[])
      }
      worker.onerror = (e) => {
        if (!off) setErr(e.message || '解析 Worker 错误')
        worker?.terminate()
      }
      worker.postMessage({ type: realType, buffer: buf }, [buf])
    }).catch((e) => {
      if (!off) setErr(String(e?.message || e))
    })

    return () => {
      off = true
      worker?.terminate()
    }
  }, [source, realType])

  if (hifi) return <OfficePdfView source={source} realType={realType} onBack={() => setHifi(false)} />

  if (err) return (
    <div className="panel" style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span>解析失败：{err}</span>
      <button onClick={() => setHifi(true)} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
        切换高保真 PDF 预览
      </button>
    </div>
  )
  if (!data) return <div className="panel">解析 OOXML 中…</div>

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="kv" style={{ marginRight: 4 }}>视图</span>
        {(['source', 'both', 'target'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              borderColor: mode === m ? 'var(--accent)' : 'var(--border)',
              color: mode === m ? 'var(--accent)' : undefined,
            }}
          >
            {m === 'source' ? '原文' : m === 'target' ? '译文' : '双栏对比'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setHifi(true)}
          style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
          title="LibreOffice 100% 高保真 PDF 渲染"
        >
          高保真 PDF 预览
        </button>
        <span className="kv">翻译模式 · 原文/译文/双栏对比</span>
      </div>
      {data.kind === 'docx' && <DocxBody blocks={data.blocks} trans={trans} mode={mode} />}
      {data.kind === 'sheet' && <SheetBody sheet={data.sheet} trans={trans} mode={mode} />}
      {data.kind === 'pptx' && <PptxBody slides={data.slides} trans={trans} mode={mode} />}
    </div>
  )
}

// ---------------------------------------------------------------- DOCX --------
function runStyle(r: Run): React.CSSProperties {
  const td: string[] = []
  if (r.underline) td.push('underline')
  if (r.strikethrough) td.push('line-through')
  return {
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? 'italic' : undefined,
    // r.fontSize 单位是 pt（w:sz/2）→ px：pt × 96/72
    fontSize: r.fontSize ? `${(r.fontSize * 96 / 72).toFixed(1)}px` : undefined,
    color: r.color,
    textDecoration: td.length ? td.join(' ') : undefined,
  }
}

// 计算每个列表项的项目符号/序号。
// 有序列表按 numId 独立、连续计数（与 Word 一致：跨中间非列表段落仍连续）。
function computeListMarkers(blocks: Block[]): Record<number, string> {
  const BULLETS = ['•', '◦', '▪', '·']
  const markers: Record<number, string> = {}
  const counters = new Map<string, Record<number, number>>() // numId -> {level: count}
  blocks.forEach((b, i) => {
    if (b.type !== 'list') return
    if (b.ordered) {
      const key = b.numId ?? '_'
      const m = counters.get(key) ?? {}
      m[b.level] = (m[b.level] ?? 0) + 1
      for (const k of Object.keys(m)) if (Number(k) > b.level) delete m[Number(k)]
      counters.set(key, m)
      markers[i] = `${m[b.level]}.`
    } else {
      markers[i] = BULLETS[Math.min(b.level, BULLETS.length - 1)]
    }
  })
  return markers
}

function DocxBlockView({ block, target, marker }: { block: Block; target?: string; marker?: string }) {
  if (block.type === 'table') {
    return (
      <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: 13 }}>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ border: '1px solid var(--border)', padding: '4px 8px' }}>
                  {cell.map((r) => r.text).join('')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (block.type === 'image') {
    const justify = block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start'
    return (
      <div style={{ display: 'flex', justifyContent: justify, margin: '8px 0' }}>
        {block.src ? (
          <img
            src={block.src}
            style={{ maxWidth: '100%', width: block.width ? Math.min(block.width, 640) : undefined, height: 'auto', borderRadius: 4 }}
          />
        ) : (
          <div className="kv" style={{ border: '1px dashed var(--border)', padding: 12, borderRadius: 4 }}>
            图片（{block.width ?? '?'}×{block.height ?? '?'}）
          </div>
        )}
      </div>
    )
  }
  if (block.type === 'list') {
    return (
      <div style={{ display: 'flex', gap: 8, margin: '3px 0', paddingLeft: 8 + block.level * 22, lineHeight: 1.7 }}>
        <span className="kv" style={{ flex: '0 0 auto', minWidth: 16, textAlign: 'right', color: '#555' }}>
          {marker ?? '•'}
        </span>
        <div style={{ flex: 1 }}>
          {target !== undefined
            ? target
            : block.runs.map((r, i) => (
                <span key={i} style={runStyle(r)}>
                  {r.text}
                </span>
              ))}
        </div>
      </div>
    )
  }
  const textAlign = block.align as React.CSSProperties['textAlign'] | undefined
  if (block.type === 'heading') {
    const size = [22, 19, 17, 15, 14, 13][Math.min(5, block.level - 1)]
    const text = target !== undefined ? target : block.runs.map((r) => r.text).join('')
    return (
      <div
        style={{
          fontSize: size,
          fontWeight: 700,
          margin: '14px 0 6px',
          textAlign,
          lineHeight: 1.4,
        }}
      >
        {text}
      </div>
    )
  }
  // paragraph
  const { spacingBefore, spacingAfter, indentLeft, indentFirstLine, lineHeight } =
    block as Extract<Block, { type: 'paragraph' }> & {
      indentFirstLine?: number
      lineHeight?: number
    }
  const paragraphStyle: React.CSSProperties = {
    margin: `${spacingBefore ?? 6}px 0 ${spacingAfter ?? 6}px`,
    lineHeight: lineHeight ?? 1.7,
    textAlign,
    paddingLeft: indentLeft,
    // w:firstLine / w:hanging → textIndent（正方向 = 首行缩进）
    textIndent: indentFirstLine ? `${indentFirstLine}px` : undefined,
  }
  if (target !== undefined) {
    return <p style={paragraphStyle}>{target}</p>
  }
  return (
    <p style={paragraphStyle}>
      {block.runs.map((r, i) => (
        <span key={i} style={runStyle(r)}>
          {r.text}
        </span>
      ))}
    </p>
  )
}

/** 块高度粗估（量测后由 VirtualList 修正） */
function estimateBlock(b: Block): number {
  if (b.type === 'image') return (b.height ? Math.min(b.height, 480) : 220) + 16
  if (b.type === 'table') return b.rows.length * 30 + 16
  const runs = 'runs' in b ? b.runs : ([] as Run[])
  const len = runs.reduce((n, r) => n + r.text.length, 0)
  const lines = Math.max(1, Math.ceil(len / 48))
  if (b.type === 'heading') return 30 + lines * 26
  if (b.type === 'list') return 8 + lines * 24
  return 12 + lines * 24
}

// 自然流式渲染（忠实还原版面），常规体量文档使用
const DOCX_NATURAL_MAX = 2000

function DocxNatural({ blocks, trans, mode, markers }: { blocks: Block[]; trans: Record<string, string>; mode: Mode; markers: Record<number, string> }) {
  return (
    <div className="viewport" style={{ height: 560, background: '#fff', color: '#111', borderRadius: 8, padding: mode === 'both' ? '8px 18px' : '12px 28px' }}>
      {mode === 'both' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 6 }}>
          <div className="kv">原文</div>
          <div className="kv">译文</div>
        </div>
      )}
      {blocks.map((b, i) =>
        mode === 'both' ? (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <DocxBlockView block={b} marker={markers[i]} />
            <DocxBlockView block={b} target={trans[`b${i}`] ?? ''} marker={markers[i]} />
          </div>
        ) : (
          <DocxBlockView key={i} block={b} target={mode === 'target' ? trans[`b${i}`] ?? '' : undefined} marker={markers[i]} />
        ),
      )}
    </div>
  )
}

function DocxBody({ blocks, trans, mode }: { blocks: Block[]; trans: Record<string, string>; mode: Mode }) {
  const markers = useMemo(() => computeListMarkers(blocks), [blocks])
  // 常规体量：自然流式渲染（版面忠实）；超大文档：虚拟化兜底
  if (blocks.length <= DOCX_NATURAL_MAX) return <DocxNatural blocks={blocks} trans={trans} mode={mode} markers={markers} />

  const renderRow = (i: number) => {
    const b = blocks[i]
    if (mode === 'both') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 18px' }}>
          <DocxBlockView block={b} marker={markers[i]} />
          <DocxBlockView block={b} target={trans[`b${i}`] ?? ''} marker={markers[i]} />
        </div>
      )
    }
    return (
      <div style={{ padding: '0 18px' }}>
        <DocxBlockView block={b} target={mode === 'target' ? trans[`b${i}`] ?? '' : undefined} marker={markers[i]} />
      </div>
    )
  }
  return (
    <div style={{ background: '#fff', color: '#111', borderRadius: 8 }}>
      {mode === 'both' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '6px 18px 0' }}>
          <div className="kv">原文</div>
          <div className="kv">译文</div>
        </div>
      )}
      <VirtualList count={blocks.length} estimate={(i) => estimateBlock(blocks[i])} height={560} renderItem={renderRow} />
    </div>
  )
}

// ---------------------------------------------------------------- XLSX --------
const HEAD_W = 48 // 行号列宽
const HEAD_H = 24 // 列头行高
const OVERSCAN = 4

// 视口虚拟化网格：行列双向只渲染可见单元格，支撑百万行表（复用 CumulativeIndex）
function VirtualSheet({
  sheet,
  trans,
  useTarget,
  height = 560,
}: {
  sheet: SheetModel
  trans: Record<string, string>
  useTarget: boolean
  height?: number
}) {
  const vpRef = useRef<HTMLDivElement>(null)
  // 使用真实列宽/行高构建索引（回退到默认值）
  const rowIdx = useMemo(
    () => new CumulativeIndex(sheet.rows, (i) => sheet.rowHeights?.[i] ?? DEFAULT_ROW_H),
    [sheet],
  )
  const colIdx = useMemo(
    () => new CumulativeIndex(sheet.cols, (i) => sheet.colWidths?.[i] ?? DEFAULT_COL_W),
    [sheet],
  )
  const [win, setWin] = useState({ r0: 0, r1: -1, c0: 0, c1: -1 })
  const rafPending = useRef(false)

  const recompute = () => {
    const vp = vpRef.current
    if (!vp) return
    const rr = rowIdx.rangeForViewport(vp.scrollTop, vp.clientHeight)
    const cc = colIdx.rangeForViewport(vp.scrollLeft, vp.clientWidth)
    setWin({
      r0: Math.max(0, rr.start - OVERSCAN),
      r1: Math.min(sheet.rows - 1, rr.end + OVERSCAN),
      c0: Math.max(0, cc.start - OVERSCAN),
      c1: Math.min(sheet.cols - 1, cc.end + OVERSCAN),
    })
  }
  useEffect(recompute, [rowIdx, colIdx])

  const onScroll = () => {
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      recompute()
    })
  }

  const totalW = colIdx.totalSize()
  const totalH = rowIdx.totalSize()
  const cells: React.ReactNode[] = []
  for (let r = win.r0; r <= win.r1; r++) {
    const rowH = rowIdx.offsetOf(r + 1) - rowIdx.offsetOf(r)
    for (let c = win.c0; c <= win.c1; c++) {
      const colW = colIdx.offsetOf(c + 1) - colIdx.offsetOf(c)
      const cell = sheet.cells.get(`${r},${c}`)
      // 空单元格也要渲染网格线，否则看起来不像表格
      const text = cell ? (useTarget ? trans[`${r},${c}`] ?? cell.text : cell.text) : ''
      cells.push(
        <div
          key={`${r},${c}`}
          title={text}
          style={{
            position: 'absolute',
            top: HEAD_H + rowIdx.offsetOf(r),
            left: HEAD_W + colIdx.offsetOf(c),
            width: colW,
            height: rowH,
            padding: '2px 6px',
            boxSizing: 'border-box',
            borderRight: '1px solid #e2e6ee',
            borderBottom: '1px solid #e2e6ee',
            fontSize: 12,
            lineHeight: `${rowH - 4}px`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {text}
        </div>,
      )
    }
  }

  const colHeads: React.ReactNode[] = []
  for (let c = win.c0; c <= win.c1; c++) {
    const colW = colIdx.offsetOf(c + 1) - colIdx.offsetOf(c)
    colHeads.push(
      <div
        key={c}
        style={{
          position: 'absolute',
          top: 0,
          left: HEAD_W + colIdx.offsetOf(c),
          width: colW,
          height: HEAD_H,
          background: '#f3f5f9',
          borderRight: '1px solid #d7dce6',
          borderBottom: '1px solid #d7dce6',
          fontSize: 11,
          lineHeight: `${HEAD_H}px`,
          textAlign: 'center',
          color: '#6b7280',
        }}
      >
        {indexToCol(c)}
      </div>,
    )
  }
  const rowHeads: React.ReactNode[] = []
  for (let r = win.r0; r <= win.r1; r++) {
    const rowH = rowIdx.offsetOf(r + 1) - rowIdx.offsetOf(r)
    rowHeads.push(
      <div
        key={r}
        style={{
          position: 'absolute',
          top: HEAD_H + rowIdx.offsetOf(r),
          left: 0,
          width: HEAD_W,
          height: rowH,
          background: '#f3f5f9',
          borderRight: '1px solid #d7dce6',
          borderBottom: '1px solid #e2e6ee',
          fontSize: 11,
          lineHeight: `${rowH}px`,
          textAlign: 'center',
          color: '#6b7280',
        }}
      >
        {r + 1}
      </div>,
    )
  }

  return (
    <div ref={vpRef} onScroll={onScroll} className="viewport" style={{ height, background: '#fff', color: '#111', position: 'relative' }}>
      <div style={{ position: 'relative', width: HEAD_W + totalW, height: HEAD_H + totalH }}>
        {cells}
        {colHeads}
        {rowHeads}
        {/* 左上角占位 */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: HEAD_W, height: HEAD_H, background: '#eceff5', borderRight: '1px solid #d7dce6', borderBottom: '1px solid #d7dce6' }} />
      </div>
    </div>
  )
}

// 干净网格表格（borderCollapse + 完整网格线 + 行列表头），常规体量使用
const SHEET_NATURAL_MAX_ROWS = 2000
const SHEET_NATURAL_MAX_COLS = 200
const SHEET_RENDER_ROWS = 500
const SHEET_RENDER_COLS = 60

function NaturalSheet({ sheet, trans, useTarget }: { sheet: SheetModel; trans: Record<string, string>; useTarget: boolean }) {
  const maxRows = Math.min(sheet.rows, SHEET_RENDER_ROWS)
  const maxCols = Math.min(sheet.cols, SHEET_RENDER_COLS)
  const rows = Array.from({ length: maxRows }, (_, r) => r)
  const cols = Array.from({ length: maxCols }, (_, c) => c)
  const headBg = '#f3f5f9'
  const headStyle: React.CSSProperties = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: headBg,
    border: '1px solid #d7dce6',
    padding: '2px 6px',
    color: '#6b7280',
    fontWeight: 500,
    textAlign: 'center',
  }
  return (
    <div className="viewport" style={{ height: 560, background: '#fff', color: '#111' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...headStyle, left: 0, zIndex: 3, minWidth: 40 }} />
            {cols.map((c) => (
              <th key={c} style={{ ...headStyle, minWidth: 64 }}>{indexToCol(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th style={{ position: 'sticky', left: 0, zIndex: 1, background: headBg, border: '1px solid #d7dce6', padding: '2px 6px', color: '#6b7280', fontWeight: 400, textAlign: 'center', minWidth: 40 }}>
                {r + 1}
              </th>
              {cols.map((c) => {
                const cell = sheet.cells.get(`${r},${c}`)
                const text = cell ? (useTarget ? trans[`${r},${c}`] ?? cell.text : cell.text) : ''
                return (
                  <td
                    key={c}
                    title={text}
                    style={{ border: '1px solid #e2e6ee', padding: '2px 6px', minWidth: 64, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SheetBody({ sheet, trans, mode }: { sheet: SheetModel; trans: Record<string, string>; mode: Mode }) {
  const natural = sheet.rows <= SHEET_NATURAL_MAX_ROWS && sheet.cols <= SHEET_NATURAL_MAX_COLS
  const Grid = ({ useTarget }: { useTarget: boolean }) =>
    natural ? <NaturalSheet sheet={sheet} trans={trans} useTarget={useTarget} /> : <VirtualSheet sheet={sheet} trans={trans} useTarget={useTarget} />
  const truncated = natural && (sheet.rows > SHEET_RENDER_ROWS || sheet.cols > SHEET_RENDER_COLS)
  const note = (
    <div className="kv" style={{ marginBottom: 4 }}>
      {sheet.name} · {sheet.rows.toLocaleString()} 行 × {sheet.cols} 列{!natural ? ' · 视口虚拟化' : truncated ? '（已截断渲染）' : ''}
    </div>
  )
  if (mode === 'both') {
    return (
      <div>
        {note}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div className="kv">原文</div>
            <Grid useTarget={false} />
          </div>
          <div>
            <div className="kv">译文</div>
            <Grid useTarget />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div>
      {note}
      <Grid useTarget={mode === 'target'} />
    </div>
  )
}

// ---------------------------------------------------------------- PPTX --------
function SlideFrame({ slide, trans, useTarget }: { slide: Slide; trans: Record<string, string>; useTarget: boolean }) {
  // 形状坐标单位是 EMU；scale = 目标宽度(px) / 幻灯片宽度(EMU) = px-per-EMU
  const sw = slide.slideWidth ?? 12192000
  const sh = slide.slideHeight ?? 6858000
  const scale = SLIDE_W / sw
  const slideH = Math.round(sh * scale)
  return (
    <div
      style={{
        position: 'relative',
        width: SLIDE_W,
        height: slideH,
        background: '#fff',
        color: '#111',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        margin: '0 auto',
      }}
    >
      {/* 图片在底层 */}
      {slide.images.map((im, i) =>
        im.src ? (
          <img
            key={`img${i}`}
            src={im.src}
            style={{
              position: 'absolute',
              left: im.x * scale,
              top: im.y * scale,
              width: im.w * scale,
              height: im.h * scale,
              objectFit: 'fill',
            }}
          />
        ) : null,
      )}
      {/* 文本在上层 */}
      {slide.texts.map((t, i) => {
        const text = useTarget ? trans[`s${slide.index}.t${i}`] ?? t.text : t.text
        const fontPx = Math.max(8, t.size * 96 / 72)
        const justify = t.anchor === 'center' ? 'center' : t.anchor === 'bottom' ? 'flex-end' : 'flex-start'
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: Math.max(0, t.x * scale),
              top: Math.max(0, t.y * scale),
              width: t.w > 0 ? t.w * scale : SLIDE_W - t.x * scale,
              height: t.h > 0 ? t.h * scale : undefined,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: justify,
              fontSize: fontPx,
              fontWeight: t.bold ? 700 : undefined,
              color: t.color ?? '#111',
              textAlign: t.align ?? 'left',
              lineHeight: 1.25,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
            }}
          >
            {text}
          </div>
        )
      })}
    </div>
  )
}

const PPTX_NATURAL_MAX = 100

function SlidePage({ slide: s, trans, mode }: { slide: Slide; trans: Record<string, string>; mode: Mode }) {
  return (
    <div style={{ paddingBottom: 18 }}>
      <div className="kv" style={{ marginBottom: 6 }}>第 {s.index + 1} 页</div>
      {mode === 'both' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SlideFrame slide={s} trans={trans} useTarget={false} />
          <SlideFrame slide={s} trans={trans} useTarget />
        </div>
      ) : (
        <SlideFrame slide={s} trans={trans} useTarget={mode === 'target'} />
      )}
    </div>
  )
}

function PptxBody({ slides, trans, mode }: { slides: Slide[]; trans: Record<string, string>; mode: Mode }) {
  // 常规页数：自然流式渲染；超多页：虚拟化兜底
  if (slides.length <= PPTX_NATURAL_MAX) {
    return (
      <div className="viewport" style={{ height: 560, padding: '4px 4px 0' }}>
        {slides.map((s) => (
          <SlidePage key={s.index} slide={s} trans={trans} mode={mode} />
        ))}
      </div>
    )
  }
  const firstSlide = slides[0]
  const slideH = firstSlide
    ? Math.round(SLIDE_W * (firstSlide.slideHeight ?? 6858000) / (firstSlide.slideWidth ?? 12192000))
    : 405
  const itemH = HEAD_H + slideH + 28
  return (
    <VirtualList
      count={slides.length}
      estimate={() => itemH}
      height={560}
      renderItem={(i) => <SlidePage slide={slides[i]} trans={trans} mode={mode} />}
    />
  )
}
