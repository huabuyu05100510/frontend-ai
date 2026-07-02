// ============================================================
// FileCard — 极致体验文件卡片（上传中 + 已完成）
// ============================================================

import React from 'react'
import type { UploadFile } from '../types'
import type { FilePreview as FilePreviewData } from '../preview'
import { formatSize } from '../validator'

interface Props {
  file: UploadFile
  preview?: FilePreviewData
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onSelect: () => void
  isSelected: boolean
}

const D = {
  purple: '#7c3aed',
  green: '#059669',
  greenBg: '#ecfdf5',
  red: '#dc2626',
  redBg: '#fef2f2',
  blue: '#2563eb',
  amber: '#d97706',
  amberBg: '#fffbeb',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  idle:       { label: '等待', color: D.gray500, bg: D.gray100 },
  validating: { label: '校验中', color: D.blue, bg: '#eff6ff' },
  processing: { label: '处理中', color: D.blue, bg: '#eff6ff' },
  hashing:    { label: '指纹计算', color: D.blue, bg: '#eff6ff' },
  checking:   { label: '秒传检测', color: D.blue, bg: '#eff6ff' },
  uploading:  { label: '上传中', color: D.amber, bg: D.amberBg },
  merging:    { label: '合并中', color: D.blue, bg: '#eff6ff' },
  done:       { label: '完成', color: D.green, bg: D.greenBg },
  instant:    { label: '秒传', color: D.purple, bg: '#f5f3ff' },
  paused:     { label: '已暂停', color: D.amber, bg: D.amberBg },
  failed:     { label: '失败', color: D.red, bg: D.redBg },
  cancelled:  { label: '已取消', color: D.gray400, bg: D.gray100 },
}

export const FileCard: React.FC<Props> = ({ file, preview, onPause, onResume, onCancel, onSelect, isSelected }) => {
  const sc = STATUS_CONFIG[file.status] ?? STATUS_CONFIG.idle
  const isActive = !['idle', 'done', 'instant', 'paused', 'failed', 'cancelled'].includes(file.status)
  const isPaused = file.status === 'paused'
  const isDone = file.status === 'done' || file.status === 'instant'

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        borderRadius: 12, cursor: 'pointer',
        background: isSelected ? '#fff' : '#fff',
        border: `1.5px solid ${isSelected ? D.purple : D.gray200}`,
        boxShadow: isSelected ? `0 0 0 3px ${'#ede9fe'}, 0 2px 8px rgba(0,0,0,0.06)` : '0 1px 2px rgba(0,0,0,0.03)',
        transition: 'all .2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = D.gray300
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
        }
      }}
      onMouseLeave={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = D.gray200
          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'
        }
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
        background: D.gray100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20,
      }}>
        {preview?.type === 'image' && preview.originalUrl ? (
          <img src={preview.originalUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : preview?.type === 'video' && preview.thumbnails?.[0] ? (
          <img src={preview.thumbnails[0].dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span>{fileIcon(file.name)}</span>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: D.gray900,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {file.name}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 500, padding: '1px 8px', borderRadius: 10,
            color: sc.color, background: sc.bg, flexShrink: 0,
          }}>
            {sc.label}
          </span>
        </div>

        {/* Progress bar */}
        {!isDone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: D.gray100, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${file.progress}%`,
                background: isPaused ? D.amber : `linear-gradient(90deg, ${D.purple}, #a78bfa)`,
                transition: 'width .4s cubic-bezier(0.4, 0, 0.2, 1)',
              }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: D.gray500, flexShrink: 0 }}>
              {file.progress}%
            </span>
          </div>
        )}

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: D.gray400, flexWrap: 'wrap' }}>
          <span>{formatSize(file.size)}</span>
          {file.compressedSize && file.compressedSize !== file.size && (
            <span style={{ color: D.green, fontWeight: 600 }}>
              → {formatSize(file.compressedSize)}
              {file.compressMeta && ` (−${Math.round(file.compressMeta.ratio * 100)}%)`}
            </span>
          )}
          {file.compressMeta && file.compressMeta.fromFormat !== file.compressMeta.toFormat && (
            <span style={{ color: D.purple }}>
              {shortMime(file.compressMeta.fromFormat)} → {shortMime(file.compressMeta.toFormat)}
            </span>
          )}
          {isDone && file.hash && (
            <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{file.hash.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {isActive && (
          <button onClick={(e) => { e.stopPropagation(); onPause() }} style={actionBtn('#f59e0b')}>
            ⏸
          </button>
        )}
        {isPaused && (
          <button onClick={(e) => { e.stopPropagation(); onResume() }} style={actionBtn(D.blue)}>
            ▶
          </button>
        )}
        {!isDone && (
          <button onClick={(e) => { e.stopPropagation(); onCancel() }} style={actionBtn(D.red, true)}>
            ✕
          </button>
        )}
        {isDone && (
          <div style={{ fontSize: 18 }}>✅</div>
        )}
      </div>
    </div>
  )
}

function shortMime(mime: string): string {
  return mime.replace('image/', '').toUpperCase()
}

export function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    pdf: '📕', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊',
    ppt: '📽️', pptx: '📽️', txt: '📝', md: '📝', csv: '📊',
    mp3: '🎵', wav: '🎵', m4a: '🎵', aac: '🎵',
    mp4: '🎬', mov: '🎬', mkv: '🎬', avi: '🎬',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', bmp: '🖼️', webp: '🖼️',
  }
  return map[ext ?? ''] ?? '📎'
}

function actionBtn(color: string, ghost: boolean = false): React.CSSProperties {
  return {
    width: 30, height: 30, border: ghost ? `1px solid #fecaca` : `1px solid #fde68a`,
    borderRadius: 8, cursor: 'pointer', fontSize: 12,
    background: ghost ? '#fff' : '#fff',
    color, display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all .15s',
  }
}