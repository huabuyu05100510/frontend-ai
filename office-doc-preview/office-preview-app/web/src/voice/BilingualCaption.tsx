// BilingualCaption — 双语对照字幕（对标 Google Translate Voice Mode / Otter.ai）
// 模型：claude-sonnet-4-6
// 颜色迁移至 semantic.ts (Phase 2.A)
import React from 'react'
import { VolumeIcon } from '../design/icons'

export interface BilingualCaptionItem {
  id: number
  source: string
  target: string
  ts: number
  translating?: boolean
}

export interface BilingualCaptionProps {
  items: BilingualCaptionItem[]
  interimSource?: string
  interimTarget?: string
  onSpeak?: (text: string, lang: string) => void
  sourceLangLabel?: string
  targetLangLabel?: string
}

export const BilingualCaption: React.FC<BilingualCaptionProps> = ({
  items, interimSource, interimTarget, onSpeak, sourceLangLabel = '原文', targetLangLabel = '译文',
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {items.map(item => (
        <div
          key={item.id}
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-light)',
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            animation: 'xf-cap-in 0.3s ease-out',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'flex', gap: 8 }}>
            <span>{new Date(item.ts).toLocaleTimeString()}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: 1 }}>
                {sourceLangLabel.toUpperCase()}
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--color-text)' }}>
                {item.source}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10, marginBottom: 4, letterSpacing: 1,
                  color: 'var(--color-ai)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <span>{targetLangLabel.toUpperCase()}</span>
                {item.target && onSpeak && (
                  <button
                    onClick={() => onSpeak(item.target, 'target')}
                    title="朗读译文"
                    style={{
                      border: 'none', background: 'transparent', color: 'var(--color-ai)',
                      cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
                    }}
                  >
                    <VolumeIcon size={14} />
                  </button>
                )}
              </div>
              <div
                style={{
                  fontSize: 15, lineHeight: 1.7,
                  color: item.translating ? 'var(--purple-4)' : 'var(--color-text)',
                  fontStyle: item.translating ? 'italic' : 'normal',
                }}
              >
                {item.target || (item.translating ? '翻译中…' : '—')}
              </div>
            </div>
          </div>
        </div>
      ))}
      {/* 实时中间结果（半透明） */}
      {(interimSource || interimTarget) && (
        <div
          style={{
            background: 'rgba(22,119,255,0.04)',
            border: '1px dashed rgba(22,119,255,0.3)',
            borderRadius: 10,
            padding: 14,
            opacity: 0.7,
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--color-primary)', marginBottom: 6, letterSpacing: 1 }}>实时识别中…</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-text)' }}>
            {interimSource}
            {interimTarget && (
              <span style={{ color: 'var(--color-ai)', marginLeft: 8 }}>→ {interimTarget}</span>
            )}
          </div>
        </div>
      )}
      <style>{`
        @keyframes xf-cap-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
BilingualCaption.displayName = 'BilingualCaption'
