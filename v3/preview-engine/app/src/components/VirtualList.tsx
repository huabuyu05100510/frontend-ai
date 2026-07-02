import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CumulativeIndex } from '../pipeline/CumulativeIndex'

// ============================================================================
// VirtualList — 变高列表虚拟化（估算 + ResizeObserver 量测修正）
//   先按 estimate 渲染，挂载后通过 ResizeObserver 量测真实高度回填 CumulativeIndex。
//   ResizeObserver 替代无依赖 useEffect，彻底消除字体加载/动态内容引发的渲染循环。
//   仅渲染视口内 + overscan 项，支撑万级 block / 千页幻灯片。
// ============================================================================

export function VirtualList({
  count,
  estimate,
  height,
  overscan = 3,
  renderItem,
}: {
  count: number
  estimate: (i: number) => number
  height: number
  overscan?: number
  renderItem: (i: number) => ReactNode
}) {
  const vpRef = useRef<HTMLDivElement>(null)
  const index = useMemo(() => new CumulativeIndex(count, estimate), [count])
  const measured = useRef<Map<number, number>>(new Map())
  const itemEls = useRef<Map<number, HTMLDivElement>>(new Map())
  const rafPending = useRef(false)
  const [range, setRange] = useState<[number, number]>([0, -1])
  const [version, setVersion] = useState(0)

  const recompute = () => {
    const vp = vpRef.current
    if (!vp) return
    const r = index.rangeForViewport(vp.scrollTop, vp.clientHeight)
    setRange([Math.max(0, r.start - overscan), Math.min(count - 1, r.end + overscan)])
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

  // ResizeObserver 量测真实高度 → 批量回填 CumulativeIndex
  // 仅在尺寸真正变化时触发，避免死循环；字体加载/动态内容均安全处理
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement
        const i = Number(el.dataset.index)
        if (!Number.isFinite(i)) continue
        const h = entry.borderBoxSize?.[0]?.blockSize ?? (el as HTMLElement).offsetHeight
        if (h > 0 && measured.current.get(i) !== h) {
          measured.current.set(i, h)
          index.setSize(i, h)
          changed = true
        }
      }
      if (changed) {
        recompute()
        setVersion((v) => v + 1)
      }
    })

    for (const [, el] of itemEls.current) ro.observe(el)
    return () => ro.disconnect()
  }, [range[0], range[1], index])

  const items: ReactNode[] = []
  for (let i = range[0]; i <= range[1]; i++) {
    items.push(
      <div
        key={i}
        data-index={i}
        ref={(el) => {
          if (el) itemEls.current.set(i, el)
          else itemEls.current.delete(i)
        }}
        style={{ position: 'absolute', top: index.offsetOf(i), left: 0, right: 0 }}
      >
        {renderItem(i)}
      </div>,
    )
  }

  return (
    <div ref={vpRef} onScroll={onScroll} className="viewport" style={{ height }}>
      <div style={{ position: 'relative', height: index.totalSize() }} data-v={version}>
        {items}
      </div>
    </div>
  )
}
