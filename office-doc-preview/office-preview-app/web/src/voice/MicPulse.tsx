// MicPulse — 中央麦克风脉冲按钮（对标 Google Translate Voice Mode / iOS 录音）
// 模型：claude-sonnet-4-6
// 颜色迁移至 semantic.ts (Phase 2.A)
import React from 'react'
import { MicIcon, MicOffIcon } from '../design/icons'

export interface MicPulseProps {
  active: boolean
  level: number
  disabled?: boolean
  onClick: () => void
  label?: string
}

export const MicPulse: React.FC<MicPulseProps> = ({ active, level, disabled, onClick, label }) => {
  const size = 120
  const scale = 1 + Math.min(0.3, level * 0.4)
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={disabled ? undefined : onClick}
      role="button"
      aria-label={label || (active ? '停止录音' : '开始录音')}
    >
      {/* 外层脉冲 */}
      {active && (
        <>
          <span
            style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,77,79,0.18), transparent 70%)',
              transform: `scale(${scale})`,
              transition: 'transform 0.12s',
            }}
          />
          <span
            style={{
              position: 'absolute', inset: -8,
              borderRadius: '50%',
              border: '2px solid rgba(255,77,79,0.4)',
              animation: 'xf-mic-ring 1.8s ease-out infinite',
            }}
          />
          <span
            style={{
              position: 'absolute', inset: -16,
              borderRadius: '50%',
              border: '2px solid rgba(255,77,79,0.2)',
              animation: 'xf-mic-ring 1.8s ease-out 0.6s infinite',
            }}
          />
        </>
      )}
      {/* 主按钮 */}
      <div
        style={{
          width: size * 0.65,
          height: size * 0.65,
          borderRadius: '50%',
          background: active
            ? 'linear-gradient(135deg, var(--red-5), var(--red-7))'
            : 'linear-gradient(135deg, var(--blue-7), var(--purple-7))',
          color: 'var(--color-text-inverse)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: active
            ? '0 12px 36px rgba(255,77,79,0.45)'
            : '0 12px 36px rgba(22,119,255,0.35)',
          transition: 'all 0.2s var(--xf-ease, ease)',
          transform: active ? `scale(${scale})` : 'scale(1)',
          zIndex: 1,
        }}
      >
        {active ? <MicIcon size={36} /> : <MicOffIcon size={36} />}
      </div>
      <style>{`
        @keyframes xf-mic-ring {
          0% { transform: scale(0.85); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
MicPulse.displayName = 'MicPulse'
