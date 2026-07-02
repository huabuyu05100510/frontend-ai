// 颜色迁移至 semantic.ts (Phase 2.A)
// ============================================================
// FilePreviewCard — 侧边栏文件预览卡片
// ============================================================

import React from 'react'
import type { UploadFile } from '../types'
import type { FilePreview as FilePreviewData } from '../preview'
import { formatSize } from '../validator'

interface Props {
  file: UploadFile
  preview: FilePreviewData | undefined
  onClose: () => void
}

const D = {
  purple: 'var(--purple-7)',
  green: 'var(--color-success)',
  greenBg: 'var(--color-success-bg)',
  red: 'var(--red-6)',
  blue: 'var(--color-accent)',
  gray50: 'var(--color-bg-subtle)',
  gray100: 'var(--color-bg-subtle)',
  gray200: 'var(--color-border-light)',
  gray300: 'var(--color-text-placeholder)',
  gray400: 'var(--color-text-tertiary)',
  gray500: 'var(--color-text-secondary)',
  gray700: 'var(--color-text-secondary)',
  gray900: 'var(--slate-12)',
}

export const FilePreviewCard: React.FC<Props> = ({ file, preview, onClose }) => {
  const isDone = file.status === 'done' || file.status === 'instant'

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>文件详情</span>
        <button onClick={onClose} style={styles.closeBtn}>✕</button>
      </div>

      {/* Preview image */}
      {preview?.type === 'image' && preview.originalUrl && (
        <div style={{ marginBottom: 12 }}>
          <img src={preview.originalUrl} alt="preview"
            style={{ width: '100%', borderRadius: 8, maxHeight: 200, objectFit: 'cover', background: D.gray100 }} />
        </div>
      )}
      {preview?.type === 'video' && preview.thumbnails?.[0] && (
        <div style={{ marginBottom: 12 }}>
          <img src={preview.thumbnails[0].dataUrl} alt="video thumb"
            style={{ width: '100%', borderRadius: 8, maxHeight: 200, objectFit: 'cover', background: D.gray100 }} />
          <div style={{ fontSize: 11, color: D.gray500, marginTop: 4, textAlign: 'center' }}>
            关键帧 · {preview.duration?.toFixed(1)}s
          </div>
        </div>
      )}
      {preview?.type === 'audio' && preview.waveformCanvas && (
        <div
          ref={el => { if (el && preview.waveformCanvas) { el.innerHTML = ''; el.appendChild(preview.waveformCanvas) } }}
          style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', background: D.gray50 }}
        />
      )}
      {preview?.type === 'document' && (
        <div style={{
          marginBottom: 12, padding: 16, borderRadius: 8, background: D.gray50,
          textAlign: 'center', fontSize: 40,
        }}>
          {file.name.endsWith('.pdf') ? '📕' : '📄'}
          <div style={{ fontSize: 11, color: D.gray500, marginTop: 4 }}>
            {preview.pageCount ? `${preview.pageCount} 页` : file.name.split('.').pop()?.toUpperCase()}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div style={{ fontSize: 12 }}>
        <Meta label="文件名" value={file.name} />
        <Meta label="大小" value={formatSize(file.size)} />
        {file.compressedSize && file.compressedSize !== file.size && (
          <Meta label="压缩后" value={formatSize(file.compressedSize)} color={D.green} />
        )}
        <Meta label="状态" value={
          file.status === 'done' ? '上传完成' :
          file.status === 'instant' ? '秒传命中' :
          file.status === 'uploading' ? '上传中...' : file.status
        } color={isDone ? D.green : file.status === 'failed' ? D.red : D.blue} />
        {file.hash && <Meta label="指纹" value={file.hash.slice(0, 12) + '...'} mono />}
        {file.url && <Meta label="URL" value={file.url} mono truncate />}
      </div>
    </div>
  )
}

function Meta({ label, value, color, mono, truncate }: {
  label: string; value: string; color?: string; mono?: boolean; truncate?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ color: D.gray400, flexShrink: 0 }}>{label}</span>
      <span style={{
        color: color ?? D.gray700, fontWeight: 500, textAlign: 'right',
        fontFamily: mono ? 'monospace' : undefined, fontSize: mono ? 11 : undefined,
        overflow: truncate ? 'hidden' : undefined, textOverflow: truncate ? 'ellipsis' : undefined,
        whiteSpace: truncate ? 'nowrap' : undefined, maxWidth: truncate ? 200 : undefined,
      }}>{value}</span>
    </div>
  )
}

const styles = {
  card: {
    background: '#fff', borderRadius: 12, padding: 16,
    border: `1px solid ${D.gray200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  } as React.CSSProperties,
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  } as React.CSSProperties,
  closeBtn: {
    width: 24, height: 24, border: 'none', borderRadius: 6, cursor: 'pointer',
    background: D.gray100, color: D.gray500, fontSize: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
}