import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { TextModel } from '../../renderers/text/TextModel'
import { CumulativeIndex } from '../../pipeline/CumulativeIndex'

const LINE_H = 20

// 真实文本渲染 + 行虚拟化（复用 CumulativeIndex），万行流畅
export function TextView({ source }: { source: SourceHandle }) {
  const [model, setModel] = useState<TextModel | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const vpRef = useRef<HTMLDivElement>(null)
  const rafPending = useRef(false)

  useEffect(() => {
    let disposed = false
    source.blob().arrayBuffer().then((buf) => {
      if (disposed) return
      setModel(new TextModel(TextModel.decode(new Uint8Array(buf))))
    })
    return () => {
      disposed = true
    }
  }, [source])

  const index = useMemo(() => (model ? new CumulativeIndex(model.lineCount, () => LINE_H) : null), [model])

  const recompute = () => {
    const vp = vpRef.current
    if (!vp || !index) return
    const r = index.rangeForViewport(vp.scrollTop, vp.clientHeight)
    setRange([Math.max(0, r.start - 5), Math.min(index.count - 1, r.end + 5)])
  }
  useEffect(recompute, [index])

  const onScroll = () => {
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      recompute()
    })
  }

  if (!model || !index) return <div className="panel">解码中…</div>
  const lines = model.getLines(range[0], range[1])

  return (
    <div>
      <div className="kv">
        {model.lineCount.toLocaleString()} 行 · 仅渲染可见 {range[0] + 1}–{range[1] + 1}（行虚拟化）
      </div>
      <div ref={vpRef} onScroll={onScroll} className="viewport" style={{ height: 540 }}>
        <div style={{ height: index.totalSize(), position: 'relative' }}>
          {lines.map((ln, i) => {
            const lineNo = range[0] + i
            return (
              <div
                key={lineNo}
                style={{
                  position: 'absolute',
                  top: lineNo * LINE_H,
                  height: LINE_H,
                  left: 0,
                  right: 0,
                  display: 'flex',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 12,
                  lineHeight: `${LINE_H}px`,
                  whiteSpace: 'pre',
                }}
              >
                <span className="muted" style={{ width: 56, textAlign: 'right', paddingRight: 12, flex: '0 0 auto' }}>
                  {lineNo + 1}
                </span>
                <span style={{ overflow: 'hidden' }}>{ln}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
