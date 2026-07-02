import { useCallback, useState } from 'react'
import { BASE_URL } from '../collab/convertClient'
import { PdfViewer } from './renderers/PdfViewer'

const DEMO_FILE = '/samples/range.pdf'

interface LogEntry { ts: number; text: string; bytes: number }

export function RangeCompareTab() {
  const [tab, setTab] = useState<'network' | 'render'>('network')

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="kv">演示: <b>range.pdf</b> · <b>164 MB</b></div>
        <span style={{ flex: 1 }} />
        <button onClick={() => setTab('network')} style={{ borderColor: tab === 'network' ? 'var(--accent)' : 'var(--border)' }}>
          网络请求对比
        </button>
        <button onClick={() => setTab('render')} style={{ borderColor: tab === 'render' ? 'var(--accent)' : 'var(--border)' }}>
          渲染首屏对比
        </button>
      </div>

      {tab === 'network' ? <NetworkDemo /> : <RenderDemo />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 网络请求对比
// ════════════════════════════════════════════════════════════════════════════

function NetworkDemo() {
  const [rangeLogs, setRangeLogs] = useState<LogEntry[]>([])
  const [rangeBytes, setRangeBytes] = useState(0)
  const [rangeTime, setRangeTime] = useState(0)
  const [rangeRunning, setRangeRunning] = useState(false)

  const [fullLogs, setFullLogs] = useState<LogEntry[]>([])
  const [fullBytes, setFullBytes] = useState(0)
  const [fullTime, setFullTime] = useState(0)
  const [fullRunning, setFullRunning] = useState(false)

  const startRange = useCallback(async () => {
    setRangeRunning(true); setRangeLogs([]); setRangeBytes(0); setRangeTime(0)
    const t0 = performance.now(); const logs: LogEntry[] = []
    const add = (text: string, bytes: number) => {
      logs.push({ ts: Math.round(performance.now() - t0), text, bytes })
      setRangeLogs([...logs]); setRangeBytes(p => p + bytes)
    }
    const url = BASE_URL + DEMO_FILE
    add('HEAD → 获取文件大小', 0)
    const head = await fetch(url, { method: 'HEAD' })
    const fileSize = parseInt(head.headers.get('Content-Length') || '0', 10)
    add(`Content-Length: ${(fileSize / 1024 / 1024).toFixed(1)}MB`, 0)

    const CHUNK = 64 * 1024
    const ranges = [[0, CHUNK - 1], [fileSize - CHUNK, fileSize - 1], [fileSize - CHUNK * 2, fileSize - CHUNK - 1], [fileSize - CHUNK * 3, fileSize - CHUNK * 2 - 1]]
    for (const [s, e] of ranges) {
      const r = `bytes=${s}-${e}`
      add(`Range: ${r}`, 0)
      const res = await fetch(url, { headers: { Range: r } })
      const buf = await res.arrayBuffer()
      add(`  ← 206 · ${(buf.byteLength / 1024).toFixed(1)}KB`, buf.byteLength)
    }
    setRangeTime(Math.round(performance.now() - t0)); setRangeRunning(false)
  }, [])

  const startFull = useCallback(async () => {
    setFullRunning(true); setFullLogs([]); setFullBytes(0); setFullTime(0)
    const t0 = performance.now(); const logs: LogEntry[] = []
    const add = (text: string, bytes: number) => {
      logs.push({ ts: Math.round(performance.now() - t0), text, bytes })
      setFullLogs([...logs]); setFullBytes(p => p + bytes)
    }
    const url = BASE_URL + DEMO_FILE
    add('fetch 完整文件（无 Range 头）', 0)
    const res = await fetch(url)
    const total = parseInt(res.headers.get('Content-Length') || '0', 10)
    const reader = res.body!.getReader()
    let loaded = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.byteLength
      if (loaded % (10 * 1024 * 1024) < value.byteLength || loaded >= total) {
        add(`下载中… ${(loaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`, value.byteLength)
      }
    }
    add(`完成 · ${(loaded / 1024 / 1024).toFixed(1)}MB`, loaded)
    setFullTime(Math.round(performance.now() - t0)); setFullRunning(false)
  }, [])

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="kv">纯 HTTP 请求对比：Range 分片 vs 全量下载</span>
        <span style={{ flex: 1 }} />
        <button onClick={startRange} disabled={rangeRunning} style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>📡 分片加载</button>
        <button onClick={startFull} disabled={fullRunning} style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>📦 全量加载</button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <DemoPanel color="var(--green)" title="📡 Range 分片" logs={rangeLogs} running={rangeRunning} time={rangeTime} bytes={rangeBytes} requests={rangeLogs.filter(l => l.bytes > 0).length} />
        <DemoPanel color="var(--yellow)" title="📦 Full 全量" logs={fullLogs} running={fullRunning} time={fullTime} bytes={fullBytes} requests={1} unit="MB" />
      </div>
    </div>
  )
}

function DemoPanel({ color, title, logs, running, time, bytes, requests, unit }: {
  color: string; title: string; logs: LogEntry[]; running: boolean; time: number; bytes: number; requests: number; unit?: string
}) {
  const u = unit || 'KB'
  const div = u === 'MB' ? 1024 * 1024 : 1024
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="panel" style={{ padding: '6px 16px', fontWeight: 'bold', color, borderBottom: `2px solid ${color}` }}>{title}</div>
      <div className="panel" style={{ padding: '8px 16px', fontFamily: 'monospace', fontSize: 11, minHeight: 300, maxHeight: 400, overflow: 'auto', background: '#1a1a2e' }}>
        {logs.length === 0 && !running && <div style={{ color: 'var(--muted)' }}>点击按钮开始</div>}
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.bytes > 0 ? color : 'var(--muted)', marginBottom: 2 }}>[{l.ts}ms] {l.text}</div>
        ))}
        {running && <div style={{ color: 'var(--accent)' }}>…</div>}
      </div>
      {time > 0 && (
        <div className="panel" style={{ padding: '6px 16px', display: 'flex', gap: 16 }}>
          <span className="kv" style={{ color }}>耗时 {time}ms</span>
          <span className="kv" style={{ color }}>下载 {(bytes / div).toFixed(1)}{u}</span>
          <span className="kv" style={{ color }}>请求 {requests} 次</span>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 渲染首屏对比
// ════════════════════════════════════════════════════════════════════════════

function RenderDemo() {
  const [leftOn, setLeftOn] = useState(false)
  const [rightOn, setRightOn] = useState(false)

  const url = BASE_URL + DEMO_FILE

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="kv">渲染首屏对比：pdf.js Range 分片 vs pdf.js 全量</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setLeftOn(true)} disabled={leftOn} style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>📡 pdf.js 分片</button>
        <button onClick={() => setRightOn(true)} disabled={rightOn} style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>📦 pdf.js 全量</button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="panel" style={{ padding: '6px 16px', fontWeight: 'bold', color: 'var(--green)', borderBottom: '2px solid var(--green)' }}>
            📡 pdf.js Range 分片加载（首屏优先，按需拉取）
          </div>
          {leftOn ? (
            <PdfViewer pdfUrl={url} downloadName="range.pdf" label="pdf.js Range 分片加载" forcedLoadMode="range" showTiming />
          ) : (
            <div className="panel" style={{ textAlign: 'center', padding: '60px 32px', color: 'var(--muted)' }}>
              <div className="pdf-skeleton" style={{ width: '60%', height: 16, margin: '0 auto 16px' }} />
              <div className="pdf-skeleton" style={{ width: '80%', height: 12, margin: '0 auto 10px' }} />
              <div className="kv" style={{ marginTop: 20 }}>点击「📡 pdf.js 分片」开始渲染</div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="panel" style={{ padding: '6px 16px', fontWeight: 'bold', color: 'var(--yellow)', borderBottom: '2px solid var(--yellow)' }}>
            📦 pdf.js 全量加载（fetch 全部 164MB 后渲染）
          </div>
          {rightOn ? (
            <PdfViewer pdfUrl={url} downloadName="range.pdf" label="pdf.js 全量加载" forcedLoadMode="full" showTiming />
          ) : (
            <div className="panel" style={{ textAlign: 'center', padding: '60px 32px', color: 'var(--muted)' }}>
              <div className="pdf-skeleton" style={{ width: '60%', height: 16, margin: '0 auto 16px' }} />
              <div className="pdf-skeleton" style={{ width: '80%', height: 12, margin: '0 auto 10px' }} />
              <div className="kv" style={{ marginTop: 20 }}>点击「📦 pdf.js 全量」开始渲染</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}