// ============================================================
// FileGallery — 上传完成文件画廊
// ============================================================

import React from 'react'
import type { UploadFile } from '../types'
import type { FilePreview as FilePreviewData } from '../preview'
import { fileIcon } from './FileCard'
import { formatSize } from '../validator'

interface Props {
  files: UploadFile[]
  previews: Map<string, FilePreviewData>
  onSelect: (id: string) => void
  selectedId: string | null
  onClear: () => void
}

const D = {
  purple: '#7c3aed',
  green: '#059669',
  greenBg: '#ecfdf5',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
}

export const FileGallery: React.FC<Props> = ({ files, previews, onSelect, selectedId, onClear }) => {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: D.gray900 }}>已上传</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
            background: D.greenBg, color: D.green,
          }}>
            {files.length}
          </span>
          <span style={{ fontSize: 12, color: D.gray400 }}>
            {formatSize(files.reduce((sum, f) => sum + f.size, 0))}
          </span>
        </div>
        <button onClick={onClear} style={clearBtnStyle}>
          清空列表
        </button>
      </div>

      {/* Gallery grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
      }}>
        {files.map(f => {
          const preview = previews.get(`${f.name}_${f.size}`)
          const isImage = preview?.type === 'image' && preview.originalUrl
          const isVideo = preview?.type === 'video' && preview.thumbnails?.[0]
          const isSelected = f.id === selectedId

          return (
            <div
              key={f.id}
              onClick={() => onSelect(f.id)}
              style={{
                borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                background: '#fff', border: `1.5px solid ${isSelected ? D.purple : D.gray200}`,
                boxShadow: isSelected ? `0 0 0 3px #ede9fe, 0 4px 12px rgba(0,0,0,0.08)` : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all .2s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: isSelected ? 'translateY(-2px)' : 'none',
              }}
              onMouseEnter={e => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = D.gray300
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
                }
              }}
              onMouseLeave={e => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = D.gray200
                  e.currentTarget.style.transform = 'none'
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'
                }
              }}
            >
              {/* Preview */}
              <div style={{
                height: 120, background: D.gray50, display: 'flex', alignItems: 'center',
                justifyContent: 'center', overflow: 'hidden',
              }}>
                {isImage ? (
                  <img src={preview!.originalUrl!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : isVideo ? (
                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <img src={preview!.thumbnails![0].dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.2)',
                    }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>▶</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 36, opacity: 0.6 }}>
                    {fileIcon(f.name)}
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ padding: '10px 12px' }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, color: D.gray900,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginBottom: 4,
                }}>
                  {f.name}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: D.gray400 }}>{formatSize(f.size)}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 6,
                    background: f.status === 'instant' ? '#f5f3ff' : D.greenBg,
                    color: f.status === 'instant' ? D.purple : D.green,
                  }}>
                    {f.status === 'instant' ? '秒传' : '完成'}
                  </span>
                </div>
                {f.url && (
                  <div style={{
                    fontSize: 10, color: D.gray400, fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginTop: 4, background: D.gray50, padding: '3px 6px', borderRadius: 4,
                  }}>
                    {f.url.split('/').pop()}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const clearBtnStyle: React.CSSProperties = {
  padding: '4px 12px', fontSize: 11, fontWeight: 500,
  border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer',
  color: '#dc2626', background: '#fff', transition: 'all .15s',
}