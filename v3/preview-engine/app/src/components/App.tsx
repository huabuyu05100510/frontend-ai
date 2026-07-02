import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { probe } from '../kernel/FormatProbe'
import { route } from '../kernel/CapabilityRouter'
import type { DeviceProfile, ProbeResult, RouteDecision } from '../kernel/types'
import { ProgressiveLoader } from '../pipeline/ProgressiveLoader'
import { CumulativeIndex } from '../pipeline/CumulativeIndex'
import { ViewportScheduler } from '../pipeline/ViewportScheduler'
import { PagePool } from '../pipeline/PagePool'
import { CollabDoc } from '../collab/CollabDoc'
import { PerfHUD } from './PerfHUD'
import { PagedRenderDemo } from './PagedRenderDemo'
import { FilePreview } from './FilePreview'
import { PdfVerifyTab } from './PdfVerifyTab'
import { ServerConvertVerify } from './ServerConvertVerify'
import { RangeCompareTab } from './RangeCompareTab'

// 模拟各格式的文件头魔数
const SAMPLES: Array<{ name: string; ext: string; head: number[] }> = [
  { name: 'report.pdf', ext: 'pdf', head: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { name: 'spec.docx', ext: 'docx', head: [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x77, 0x6f, 0x72, 0x64, 0x2f] },
  { name: 'data.xlsx', ext: 'xlsx', head: [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x78, 0x6c, 0x2f] },
  { name: 'deck.pptx', ext: 'pptx', head: [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x70, 0x70, 0x74, 0x2f] },
  { name: 'legacy.doc', ext: 'doc', head: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { name: 'movie.mp4', ext: 'mp4', head: [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d] },
  { name: 'clip.mkv', ext: 'mkv', head: [0x1a, 0x45, 0xdf, 0xa3] },
  { name: 'voice.amr', ext: 'amr', head: [0x23, 0x21, 0x41, 0x4d, 0x52] },
  { name: 'photo.png', ext: 'png', head: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'subtitle.srt', ext: 'srt', head: [0x31, 0x0a] },
  { name: '伪装病毒.jpg', ext: 'jpg', head: [0x4d, 0x5a, 0x90, 0x00] }, // exe 改名
]

const DEVICES: Record<string, DeviceProfile> = {
  高端机: { tier: 'high', wasmEnabled: true, hardwareConcurrency: 8, canPlayType: () => true },
  弱机无WASM: { tier: 'low', wasmEnabled: false, hardwareConcurrency: 2, canPlayType: () => false },
}

function ProbeRouteDemo() {
  const [deviceKey, setDeviceKey] = useState('高端机')
  const [sel, setSel] = useState<{ p: ProbeResult; d: RouteDecision; name: string } | null>(null)
  const [stage, setStage] = useState<string>('idle')
  const [firstVisible, setFirstVisible] = useState<number | null>(null)
  const [hiResAt, setHiResAt] = useState<number | null>(null)

  const open = (s: (typeof SAMPLES)[number]) => {
    const p = probe(new Uint8Array(s.head), s.ext)
    const d = route(p, DEVICES[deviceKey])
    setSel({ p, d, name: s.name })
    setStage('idle')
    setFirstVisible(null)
    setHiResAt(null)

    const t0 = performance.now()
    const loader = new ProgressiveLoader({
      loadSkeleton: () => new Promise((r) => setTimeout(r, 14)),
      loadLQIP: p.category === 'unknown' ? undefined : () => new Promise((r) => setTimeout(() => r('lqip'), 70)),
      loadHiRes: () => new Promise((r) => setTimeout(() => r('hi'), 320)),
      now: () => performance.now() - t0,
    })
    loader.on((snap) => {
      setStage(snap.stage)
      if (snap.firstVisibleAt != null) setFirstVisible(Math.round(snap.firstVisibleAt))
    })
    loader.start().then(() => setHiResAt(Math.round(performance.now() - t0)))
  }

  const STAGE_ORDER = ['skeleton', 'lqip', 'hires-loading', 'hires-ready', 'error']
  const SEG_NAMES = ['skeleton', 'lqip', 'hires-ready']
  const segOn = (name: string) =>
    STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(name)

  return (
    <div>
      <div className="panel">
        <div className="kv">设备能力（影响 Native/WASM/Server 决策）：</div>
        <div className="row" style={{ marginBottom: 8 }}>
          {Object.keys(DEVICES).map((k) => (
            <button key={k} onClick={() => setDeviceKey(k)} style={{ borderColor: k === deviceKey ? 'var(--accent)' : undefined }}>
              {k}
            </button>
          ))}
        </div>
        <div className="row">
          {SAMPLES.map((s) => (
            <span key={s.name} className="chip" onClick={() => open(s)}>
              {s.name}
            </span>
          ))}
        </div>
      </div>

      {sel && (
        <div className="panel">
          <div style={{ fontSize: 15, marginBottom: 8 }}>{sel.name}</div>
          <div className="kv">
            真实类型 <b>{sel.p.realType}</b> · 类别 <b>{sel.p.category}</b> · 容器 <b>{String(sel.p.container)}</b> ·
            可信 <b style={{ color: sel.p.trusted ? 'var(--green)' : 'var(--red)' }}>{String(sel.p.trusted)}</b>
          </div>
          <div className="kv">
            渲染路径 <span className={`badge ${sel.d.path}`}>{sel.d.path.toUpperCase()}</span> — {sel.d.reason}
          </div>
          {sel.p.category === 'unknown' && (
            <div className="kv" style={{ color: 'var(--red)' }}>⚠ 伪造类型已被拦截（魔数 ≠ 扩展名声明）</div>
          )}

          <div className="stage-track">
            {SEG_NAMES.map((n) => (
              <div key={n} className={`stage-seg ${segOn(n) ? 'on' : ''}`} title={n} />
            ))}
          </div>
          <div className="kv" style={{ marginTop: 8 }}>
            阶段 <b>{stage}</b>
            {firstVisible != null && (
              <>
                {' '}· 首个内容可见 <b style={{ color: 'var(--green)' }}>{firstVisible}ms</b>
              </>
            )}
            {hiResAt != null && (
              <>
                {' '}· 高清就绪 <b>{hiResAt}ms</b>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const ROW_H = 28
const TOTAL_ROWS = 1_000_000

function VirtualScrollDemo() {
  const index = useMemo(() => new CumulativeIndex(TOTAL_ROWS, () => ROW_H), [])
  const scheduler = useMemo(() => new ViewportScheduler(index, { overscan: 6 }), [index])
  const poolRef = useRef<PagePool<{ used: boolean }>>()
  const createdRef = useRef(0)
  if (!poolRef.current) {
    poolRef.current = new PagePool<{ used: boolean }>({
      capacity: 64,
      create: () => {
        createdRef.current++
        return { used: false }
      },
    })
  }

  const [visible, setVisible] = useState<number[]>([])
  const [stats, setStats] = useState({ start: 0, end: 0, active: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const rafPending = useRef(false)

  const recompute = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const plan = scheduler.update(el.scrollTop, el.clientHeight)
    const pool = poolRef.current!
    plan.recycle.forEach((i) => pool.release(i))
    plan.visible.forEach((i) => pool.acquire(i))
    plan.prefetch.forEach((i) => pool.acquire(i))
    const rendered = scheduler.rendered().sort((a, b) => a - b)
    setVisible(rendered)
    const vr = index.rangeForViewport(el.scrollTop, el.clientHeight)
    setStats({ start: vr.start, end: vr.end, active: pool.size() })
  }, [index, scheduler])

  const onScroll = useCallback(() => {
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      recompute()
    })
  }, [recompute])

  useEffect(() => {
    recompute()
  }, [recompute])

  const total = index.totalSize()

  return (
    <div>
      <div className="panel">
        <div className="kv">
          {TOTAL_ROWS.toLocaleString()} 行 · 内容总高 {(total / 1000).toLocaleString()}k px · DOM 节点恒定（仅渲染可见 ±overscan）
        </div>
      </div>
      <div className="viewport" ref={viewportRef} onScroll={onScroll}>
        <div style={{ height: total, position: 'relative' }}>
          {visible.map((i) => (
            <div className="page-cell" key={i} style={{ top: index.offsetOf(i), height: ROW_H }}>
              <span className="muted" style={{ width: 90 }}>
                #{i.toLocaleString()}
              </span>
              <span>行内容 · 累计偏移 {index.offsetOf(i).toLocaleString()}px</span>
            </div>
          ))}
        </div>
      </div>
      <PerfHUD
        rows={[
          ['可见行', `${stats.start}–${stats.end}`],
          ['活跃DOM', `${visible.length}`],
          ['对象池', `${stats.active}/64`],
          ['累计创建', `${createdRef.current}`],
        ]}
      />
    </div>
  )
}

function CollabDemo() {
  const [, force] = useState(0)
  const rerender = () => force((x) => x + 1)
  const aRef = useRef(new CollabDoc<string>('Alice'))
  const bRef = useRef(new CollabDoc<string>('Bob'))
  const [offline, setOffline] = useState(false)
  const pending = useRef<Array<{ from: 'a' | 'b'; u: ReturnType<CollabDoc<string>['set']> }>>([])
  const counter = useRef(0)

  const addAnnot = (who: 'a' | 'b') => {
    const doc = who === 'a' ? aRef.current : bRef.current
    const id = `annot-${++counter.current}`
    const u = doc.set(id, `${who === 'a' ? 'Alice' : 'Bob'} 的批注 #${counter.current}`)
    if (offline) pending.current.push({ from: who, u })
    else {
      ;(who === 'a' ? bRef.current : aRef.current).applyUpdate(u)
    }
    rerender()
  }

  const sync = () => {
    // 双向全量合并（断网重连）
    aRef.current.merge(bRef.current.snapshot())
    bRef.current.merge(aRef.current.snapshot())
    pending.current = []
    rerender()
  }

  const converged = JSON.stringify(aRef.current.snapshot()) === JSON.stringify(bRef.current.snapshot())

  const render = (doc: CollabDoc<string>) => (
    <div className="annot-list">
      {doc.entries().length === 0 && <span className="muted">（空）</span>}
      {doc.entries().map(([k, v]) => (
        <div key={k}>
          {k}: {v}
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <button onClick={() => addAnnot('a')}>Alice 加批注</button>
          <button onClick={() => addAnnot('b')}>Bob 加批注</button>
          <button onClick={() => setOffline((o) => !o)} style={{ borderColor: offline ? 'var(--yellow)' : undefined }}>
            {offline ? '🔌 离线中（编辑本地暂存）' : '🌐 在线（实时同步）'}
          </button>
          <button onClick={sync}>重连/全量合并</button>
        </div>
        <div className="kv">
          一致性：
          <b style={{ color: converged ? 'var(--green)' : 'var(--yellow)' }}>
            {converged ? 'CONVERGED 已收敛' : 'DIVERGED 待同步'}
          </b>
          {offline && pending.current.length > 0 && <span className="muted"> · 离线暂存 {pending.current.length} 条</span>}
        </div>
      </div>
      <div className="row">
        <div className="panel" style={{ flex: 1, minWidth: 280 }}>
          <div className="kv">
            <b>Alice</b> 的副本
          </div>
          {render(aRef.current)}
        </div>
        <div className="panel" style={{ flex: 1, minWidth: 280 }}>
          <div className="kv">
            <b>Bob</b> 的副本
          </div>
          {render(bRef.current)}
        </div>
      </div>
    </div>
  )
}

const TABS = ['分片 vs 全量对比', '真实文件预览', 'PDF 验证', '服务端转换验证', '极致首屏 · 探测/路由', '真实分页 · Canvas 池', '百万行虚拟滚动', '协同批注（CRDT）']

export function App() {
  const [tab, setTab] = useState(0)
  return (
    <div className="app">
      <h1>通用文件预览引擎</h1>
      <div className="sub">FormatProbe → CapabilityRouter → 三段式渐进首屏 / 视口调度 + 对象池 / CRDT 协同</div>
      <div className="tabs">
        {TABS.map((t, i) => (
          <div key={t} className={`tab ${i === tab ? 'active' : ''}`} onClick={() => setTab(i)}>
            {t}
          </div>
        ))}
      </div>
      {tab === 0 && <RangeCompareTab />}
      {tab === 1 && <FilePreview />}
      {tab === 2 && <PdfVerifyTab />}
      {tab === 3 && <ServerConvertVerify />}
      {tab === 4 && <ProbeRouteDemo />}
      {tab === 5 && <PagedRenderDemo />}
      {tab === 6 && <VirtualScrollDemo />}
      {tab === 7 && <CollabDemo />}
    </div>
  )
}
