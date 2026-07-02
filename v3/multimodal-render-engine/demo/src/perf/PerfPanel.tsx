/**
 * PerfPanel — 性能可视化浮层
 *
 * 固定在右下角，展示 FPS / 渲染时间 / R-Tree 命中时间 / 标注数 / 内存池占用
 * 由 PerfCollector.subscribe() 驱动，每 500ms 更新一次
 */
import React, { useState, useEffect } from 'react'
import type { PerfCollector, PerfSnapshot } from './PerfCollector'

// ─── 阈值配置 ────────────────────────────────────────────────────────────────

interface Threshold { warn: number; danger: number }

const THRESHOLDS = {
  fps:        { warn: 50,  danger: 30   } as Threshold,  // 越低越差
  renderTime: { warn: 8,   danger: 16   } as Threshold,  // 越高越差
  hitTestTime:{ warn: 0.5, danger: 1    } as Threshold,
}

function getFpsColor(fps: number): string {
  if (fps >= THRESHOLDS.fps.warn)   return '#73d13d'   // 绿
  if (fps >= THRESHOLDS.fps.danger) return '#ffd666'   // 黄
  return '#ff7875'                                      // 红
}

function getTimeColor(ms: number, t: Threshold): string {
  if (ms <= t.warn)   return '#73d13d'
  if (ms <= t.danger) return '#ffd666'
  return '#ff7875'
}

// ─── MetricBar 子组件 ─────────────────────────────────────────────────────

interface MetricBarProps {
  label: string
  value: number
  maxValue: number
  color: string
  unit: string
  extra?: string
}

function MetricBar({ label, value, maxValue, color, unit, extra }: MetricBarProps) {
  const pct = Math.min(100, (value / maxValue) * 100)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#8c9bb5', fontSize: 10 }}>{label}</span>
        <span style={{ color, fontSize: 10, fontWeight: 600 }}>
          {typeof value === 'number' ? (value % 1 === 0 ? value : value.toFixed(1)) : value}{unit}
          {extra && <span style={{ marginLeft: 4, color: '#8c9bb5', fontWeight: 400 }}>{extra}</span>}
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.4s ease, background 0.3s',
        }} />
      </div>
    </div>
  )
}

// ─── PerfPanel 主组件 ─────────────────────────────────────────────────────

export interface PerfPanelProps {
  collector: PerfCollector
  visible: boolean
  onClose: () => void
}

export function PerfPanel({ collector, visible, onClose }: PerfPanelProps): JSX.Element | null {
  const [snap, setSnap] = useState<PerfSnapshot>(collector.getSnapshot())

  useEffect(() => {
    const unsub = collector.subscribe(s => setSnap(s))
    return unsub
  }, [collector])

  if (!visible) return null

  const fpsColor   = getFpsColor(snap.fps)
  const rtColor    = getTimeColor(snap.renderTime, THRESHOLDS.renderTime)
  const hitColor   = getTimeColor(snap.hitTestTime, THRESHOLDS.hitTestTime)
  const poolPct    = snap.poolMax > 0 ? snap.poolSize / snap.poolMax : 0

  return (
    <div style={{
      position: 'fixed',
      right: 16,
      bottom: 16,
      width: 230,
      background: 'rgba(10, 14, 26, 0.90)',
      backdropFilter: 'blur(8px)',
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.08)',
      padding: '12px 14px',
      zIndex: 9999,
      fontFamily: 'ui-monospace, "Cascadia Code", Menlo, monospace',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: snap.fps >= 50 ? '#73d13d' : '#ff7875',
            boxShadow: `0 0 6px ${snap.fps >= 50 ? '#73d13d' : '#ff7875'}`,
          }} />
          <span style={{ color: '#e8eaed', fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
            PERF MONITOR
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#8c9bb5', fontSize: 14, lineHeight: 1, padding: '0 2px',
          }}
          title="关闭"
        >×</button>
      </div>

      {/* FPS */}
      <MetricBar
        label="FPS"
        value={snap.fps}
        maxValue={60}
        color={fpsColor}
        unit=" fps"
      />

      {/* 渲染时间 */}
      <MetricBar
        label="渲染时间"
        value={snap.renderTime}
        maxValue={16}
        color={rtColor}
        unit="ms"
        extra="annotation"
      />

      {/* R-Tree 命中 */}
      <MetricBar
        label="R-Tree 命中"
        value={snap.hitTestTime}
        maxValue={1}
        color={hitColor}
        unit="ms"
      />

      {/* 标注数 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#8c9bb5', fontSize: 10 }}>标注数</span>
        <span style={{ color: '#cdd6f4', fontSize: 10, fontWeight: 600 }}>{snap.annotationCount}</span>
      </div>

      {/* 内存池 */}
      <div style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: '#8c9bb5', fontSize: 10 }}>内存池</span>
          <span style={{ color: '#89dceb', fontSize: 10, fontWeight: 600 }}>
            {snap.poolSize}/{snap.poolMax} 页
          </span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${poolPct * 100}%`,
            background: poolPct > 0.8 ? '#ffd666' : '#89dceb',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>
    </div>
  )
}
