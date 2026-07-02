import React from 'react'

type TipLevel = 'info' | 'success' | 'warning' | 'error'

interface TipBlockProps {
  level?: TipLevel
  title?: string
  content: string
  actions?: Array<{ label: string; href?: string }>
}

const LEVEL_CONFIG: Record<TipLevel, { icon: string; bg: string; border: string; color: string; titleColor: string }> = {
  info:    { icon: 'ℹ️', bg: '#e6f4ff', border: '#91caff', color: '#1d4ed8', titleColor: '#0958d9' },
  success: { icon: '✅', bg: '#f6ffed', border: '#b7eb8f', color: '#237804', titleColor: '#389e0d' },
  warning: { icon: '⚠️', bg: '#fffbe6', border: '#ffe58f', color: '#874d00', titleColor: '#d46b08' },
  error:   { icon: '❌', bg: '#fff2f0', border: '#ffccc7', color: '#820014', titleColor: '#cf1322' },
}

export function TipBlock({ level = 'info', title, content, actions = [] }: TipBlockProps) {
  const cfg = LEVEL_CONFIG[level]

  return (
    <div style={{
      background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8,
      padding: '12px 16px', maxWidth: 400,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
        <div style={{ flex: 1 }}>
          {title && (
            <div style={{ fontSize: 13, fontWeight: 600, color: cfg.titleColor, marginBottom: 4 }}>
              {title}
            </div>
          )}
          <div style={{ fontSize: 13, color: cfg.color, lineHeight: 1.6 }}>
            {content}
          </div>
          {actions.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {actions.map((a, i) => (
                <a key={i} href={a.href || '#'} style={{
                  fontSize: 12, color: cfg.titleColor, fontWeight: 600,
                  textDecoration: 'none', cursor: 'pointer',
                }}>
                  {a.label} →
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
