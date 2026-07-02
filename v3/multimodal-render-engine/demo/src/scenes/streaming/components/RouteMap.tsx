import React from 'react'

interface RouteStep {
  name: string
  duration?: string
  distance?: string
}

interface RouteMapProps {
  origin: string
  destination: string
  totalDuration?: string
  totalDistance?: string
  steps?: RouteStep[]
  mode?: 'drive' | 'walk' | 'transit' | 'bike'
}

const MODE_CONFIG = {
  drive:   { icon: '🚗', label: '驾车', color: '#1890ff' },
  walk:    { icon: '🚶', label: '步行', color: '#52c41a' },
  transit: { icon: '🚌', label: '公交', color: '#722ed1' },
  bike:    { icon: '🚲', label: '骑行', color: '#fa8c16' },
}

export function RouteMap({ origin, destination, totalDuration, totalDistance, steps = [], mode = 'drive' }: RouteMapProps) {
  const cfg = MODE_CONFIG[mode]

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      maxWidth: 360, border: '1px solid #f0f0f0',
    }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          background: cfg.color, color: '#fff', borderRadius: 8, padding: '4px 10px',
          fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {cfg.icon} {cfg.label}
        </span>
        {totalDuration && (
          <span style={{ fontSize: 13, fontWeight: 700, color: '#262626' }}>{totalDuration}</span>
        )}
        {totalDistance && (
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>({totalDistance})</span>
        )}
      </div>

      {/* 起终点 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#52c41a', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#262626', fontWeight: 500 }}>{origin}</span>
        </div>

        {/* 中间步骤 */}
        {steps.length > 0 && (
          <div style={{ marginLeft: 4, borderLeft: `2px dashed ${cfg.color}`, paddingLeft: 12, paddingTop: 4, paddingBottom: 4 }}>
            {steps.map((step, i) => (
              <div key={i} style={{ fontSize: 12, color: '#595959', marginBottom: 4, display: 'flex', gap: 8 }}>
                <span>{step.name}</span>
                {step.duration && <span style={{ color: '#8c8c8c' }}>{step.duration}</span>}
              </div>
            ))}
          </div>
        )}
        {steps.length === 0 && (
          <div style={{ marginLeft: 4, borderLeft: `2px dashed ${cfg.color}`, height: 20 }} />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ff4d4f', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#262626', fontWeight: 500 }}>{destination}</span>
        </div>
      </div>
    </div>
  )
}
