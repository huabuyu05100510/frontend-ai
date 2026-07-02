import React, { useEffect, useState } from 'react'
import type { PerfCollector } from '../perf/PerfCollector'
import type { PerfSnapshot } from '../core/types'

interface PerfPanelProps {
  collector: PerfCollector
  visible: boolean
  onClose: () => void
}

function bar(value: number, max: number, color: string): string {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const filled = Math.round(pct / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function fpsColor(fps: number): string {
  if (fps >= 50) return '#a6e3a1'
  if (fps >= 30) return '#f9e2af'
  return '#f38ba8'
}

function timeColor(ms: number, threshold: number): string {
  if (ms <= threshold * 0.5) return '#a6e3a1'
  if (ms <= threshold) return '#f9e2af'
  return '#f38ba8'
}

export const PerfPanel: React.FC<PerfPanelProps> = ({ collector, visible, onClose }) => {
  const [snap, setSnap] = useState<PerfSnapshot>(collector.getSnapshot())

  useEffect(() => {
    const unsub = collector.subscribe(setSnap)
    return unsub
  }, [collector])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      width: 240,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(8px)',
      borderRadius: 10,
      padding: 12,
      zIndex: 9999,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 11,
      color: '#cdd6f4',
      border: '1px solid #313244',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: '#cba6f7' }}>PERF MONITOR</span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#6c7086',
            cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
          }}
        >
          x
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row label="FPS" value={snap.fps.toString()} bar={bar(snap.fps, 60, '')} color={fpsColor(snap.fps)} />
        <Row label="渲染" value={`${snap.renderTime.toFixed(1)}ms`} bar={bar(snap.renderTime, 16, '')} color={timeColor(snap.renderTime, 16)} />
        <Row label="OT" value={`${snap.operationTime.toFixed(1)}ms`} bar={bar(snap.operationTime, 1, '')} color={timeColor(snap.operationTime, 1)} />
        <Row label="AI首帧" value={`${snap.aiLatency}ms`} bar={bar(snap.aiLatency, 500, '')} color={timeColor(snap.aiLatency, 500)} />
        <div style={{ height: 1, background: '#313244', margin: '2px 0' }} />
        <Row label="文档" value={`${snap.documentSize.toLocaleString()} 字`} />
        <Row label="块数" value={snap.blockCount.toString()} />
        <Row label="协作者" value={`${snap.collaborators} 人`} />
      </div>
    </div>
  )
}

function Row({ label, value, bar, color }: { label: string; value: string; bar?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ color: '#6c7086', minWidth: 48 }}>{label}</span>
      {bar && <span style={{ color: color ?? '#6c7086', flex: 1, margin: '0 6px', fontSize: 9, letterSpacing: -1 }}>{bar}</span>}
      <span style={{ color: color ?? '#cdd6f4', textAlign: 'right', minWidth: 48, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}