// 性能可观测浮层：订阅 perf 指标，实时展示全链路数据
import { useEffect, useState } from 'react'
import { usePerf, startFpsMeter, stopFpsMeter } from '../perf'

function ms(n: number) { return n ? `${n} ms` : '-' }
function bps(n: number) {
  if (!n) return '-'
  if (n > 1048576) return `${(n / 1048576).toFixed(1)} MB/s`
  return `${(n / 1024).toFixed(0)} KB/s`
}
function sz(n: number) {
  if (!n) return '-'
  const u = ['B', 'KB', 'MB', 'GB']; let v = n, i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`
}

export function PerfPanel() {
  const m = usePerf()
  const [open, setOpen] = useState(true)

  useEffect(() => {
    startFpsMeter()
    return stopFpsMeter
  }, [])

  const ratio = m.previewSize && m.docSize ? (m.previewSize / m.docSize * 100).toFixed(0) + '%' : '-'
  const dlPct = m.docSize ? (m.downloaded / m.docSize * 100).toFixed(0) + '%' : '-'

  return (
    <>
      <button className="perf-toggle" onClick={() => setOpen(o => !o)}>⚡</button>
      {open && (
        <div className="perf-panel">
          <div className="perf-head">性能面板 <span className="perf-fps">FPS {m.fps}</span></div>
          <div className="perf-section">
            <div className="perf-label">文档</div>
            <Row k="页数" v={m.pages || '-'} />
            <Row k="源大小" v={sz(m.docSize)} />
            <Row k="PDF大小" v={sz(m.previewSize)} />
            <Row k="压缩比" v={ratio} />
            <Row k="已下载" v={`${sz(m.downloaded)} (${dlPct})`} />
          </div>
          <div className="perf-section">
            <div className="perf-label">首屏 / 解析</div>
            <Row k="文档解析" v={ms(m.tParseMs)} />
            <Row k="首页上屏" v={ms(m.tFirstPageMs)} />
            <Row k="下载速率" v={bps(m.downloadBps)} />
          </div>
          <div className="perf-section">
            <div className="perf-label">渲染</div>
            <Row k="已渲染页" v={m.renderedPages || '-'} />
            <Row k="单页耗时" v={ms(m.lastRenderMs)} />
            <Row k="滚动速度" v={m.scrollVel ? `${m.scrollVel} px/s` : '-'} />
            {m.alignSamples > 0 && (
              <Row k="选区对齐" v={`${m.alignErrorAvg} / ${m.alignErrorMax} px (n=${m.alignSamples})`} />
            )}
          </div>
          <div className="perf-section">
            <div className="perf-label">运行</div>
            <Row k="FPS" v={m.fps || '-'} />
            <Row k="JS 堆内存" v={m.memMb ? `${m.memMb} MB` : 'N/A'} />
          </div>
          {m.convertMs > 0 && (
            <div className="perf-section">
              <div className="perf-label">转码 (soffice)</div>
              <Row k="转码耗时" v={ms(m.convertMs)} />
              <Row k="重试" v={m.convertRetries} />
              {m.convertEtaSec > 0 && <Row k="预估剩余" v={`${m.convertEtaSec}s`} />}
              {m.convertElapsedSec > 0 && <Row k="已用时" v={`${m.convertElapsedSec}s`} />}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="perf-row">
      <span className="perf-k">{k}</span>
      <span className="perf-v">{v}</span>
    </div>
  )
}
