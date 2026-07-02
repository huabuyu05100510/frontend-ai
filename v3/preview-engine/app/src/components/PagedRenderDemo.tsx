import { useEffect, useMemo, useRef, useState } from 'react'
import { probe } from '../kernel/FormatProbe'
import { RendererRegistry } from '../kernel/RendererRegistry'
import type { RendererPlugin, PaintQuality } from '../kernel/RendererPlugin'
import { CumulativeIndex } from '../pipeline/CumulativeIndex'
import { ViewportScheduler } from '../pipeline/ViewportScheduler'
import { PagePool } from '../pipeline/PagePool'
import { PerfHUD } from './PerfHUD'

const PAGE_COUNT = 500
const PAGE_W = 400
const GAP = 12
// 变高页（模拟不同页尺寸），驱动 CumulativeIndex 二分定位
const pageHeight = (i: number) => 520 + (i % 4) * 40 + GAP

function hue(i: number) {
  return (i * 47) % 360
}

/** 真实地把一页绘制到 canvas：LQIP=低清底色占位，hires=详细内容 */
function paintPage(canvas: HTMLCanvasElement, index: number, w: number, h: number, quality: PaintQuality) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  if (quality === 'lqip') {
    // 低清：纯色封面 + 模糊大页码（< 100ms 即可见）
    ctx.fillStyle = `hsl(${hue(index)}, 30%, 22%)`
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.font = 'bold 120px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(index + 1), w / 2, h / 2 + 40)
    return
  }

  // 高清：白页 + 标题块 + 文本行 + 页脚（模拟真实文档渲染产物）
  ctx.fillStyle = '#fbfbfb'
  ctx.fillRect(0, 0, w, h - GAP)
  ctx.fillStyle = `hsl(${hue(index)}, 60%, 50%)`
  ctx.fillRect(28, 32, w - 56, 26) // 标题条
  ctx.fillStyle = '#c9d1d9'
  for (let r = 0; r < 14; r++) {
    const lineW = r % 5 === 4 ? (w - 56) * 0.5 : w - 56
    ctx.fillRect(28, 84 + r * 26, lineW, 12)
  }
  ctx.fillStyle = '#8b949e'
  ctx.font = '13px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`第 ${index + 1} / ${PAGE_COUNT} 页`, w - 28, h - GAP - 18)
}

export function PagedRenderDemo() {
  const index = useMemo(() => new CumulativeIndex(PAGE_COUNT, pageHeight), [])
  const scheduler = useMemo(() => new ViewportScheduler(index, { overscan: 2 }), [index])

  // 通过插件路由拿到渲染器（与真实 PDF.js 接入方式一致）
  const renderer = useMemo<RendererPlugin>(() => {
    const reg = new RendererRegistry()
    reg.register({
      name: 'paged-canvas',
      match: (pr) => (pr.category === 'paged' ? 1 : 0),
      capabilities: () => ['annotate'],
      paintUnit: (unit, canvas) => paintPage(canvas, unit.index, unit.width, unit.height, unit.quality),
    })
    return reg.resolve(probe(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'pdf'))!
  }, [])

  const viewportRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const createdRef = useRef(0)
  const mounted = useRef(new Map<number, HTMLCanvasElement>())
  const hiresTimers = useRef(new Map<number, number>())
  const rafPending = useRef(false)
  const [stats, setStats] = useState({ range: '0–0', dom: 0, pool: 0, created: 0 })

  const pool = useMemo(
    () =>
      new PagePool<HTMLCanvasElement>({
        capacity: 24, // 远大于「可见+overscan」，正常滚动靠 recycle 回收
        create: () => {
          createdRef.current++
          const c = document.createElement('canvas')
          c.style.position = 'absolute'
          c.style.left = '50%'
          c.style.transform = 'translateX(-50%)'
          c.style.borderRadius = '4px'
          c.style.boxShadow = '0 2px 12px rgba(0,0,0,0.4)'
          return c
        },
        reset: (c) => {
          const ctx = c.getContext('2d')
          ctx?.clearRect(0, 0, c.width, c.height)
        },
        dispose: (c) => c.remove(),
      }),
    [],
  )

  const recompute = () => {
    const vp = viewportRef.current
    const inner = innerRef.current
    if (!vp || !inner) return
    const plan = scheduler.update(vp.scrollTop, vp.clientHeight)

    // 离屏页：移出 DOM + 归还对象池（取消未完成的高清绘制）
    for (const i of plan.recycle) {
      const el = mounted.current.get(i)
      if (el) el.remove()
      mounted.current.delete(i)
      const t = hiresTimers.current.get(i)
      if (t) {
        clearTimeout(t)
        hiresTimers.current.delete(i)
      }
      pool.release(i)
    }

    // 进入窗口的页：复用 canvas + 三段式（先 LQIP 立即可见，再异步高清）
    for (const i of [...plan.visible, ...plan.prefetch]) {
      if (mounted.current.has(i)) continue
      const w = PAGE_W
      const h = pageHeight(i) - GAP
      const canvas = pool.acquire(i)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      canvas.style.top = `${index.offsetOf(i)}px`
      if (!canvas.isConnected) inner.appendChild(canvas)
      mounted.current.set(i, canvas)

      renderer.paintUnit?.({ index: i, width: w, height: h, quality: 'lqip' }, canvas)
      const timer = window.setTimeout(() => {
        const cur = mounted.current.get(i)
        if (cur === canvas) renderer.paintUnit?.({ index: i, width: w, height: h, quality: 'hires' }, canvas)
        hiresTimers.current.delete(i)
      }, 80 + (i % 5) * 20)
      hiresTimers.current.set(i, timer)
    }

    const vr = index.rangeForViewport(vp.scrollTop, vp.clientHeight)
    setStats({
      range: `${vr.start + 1}–${vr.end + 1}`,
      dom: mounted.current.size,
      pool: pool.size(),
      created: createdRef.current,
    })
  }

  const onScroll = () => {
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      recompute()
    })
  }

  useEffect(() => {
    recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="panel">
        <div className="kv">
          {PAGE_COUNT} 页变高文档（PDF 路由 → <b>paged-canvas</b> 插件）· 真实 <b>&lt;canvas&gt;</b> 元素池化复用 ·
          每页「低清即时可见 → 高清异步替换」
        </div>
      </div>
      <div className="viewport" ref={viewportRef} onScroll={onScroll} style={{ height: 520 }}>
        <div ref={innerRef} style={{ height: index.totalSize(), position: 'relative' }} />
      </div>
      <PerfHUD
        rows={[
          ['可见页', stats.range],
          ['DOM canvas', `${stats.dom}`],
          ['对象池', `${stats.pool}/24`],
          ['累计创建', `${stats.created}`],
        ]}
      />
    </div>
  )
}
