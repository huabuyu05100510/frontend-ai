// ============================================================
// UploadZone — 极致体验拖拽上传入口
// ============================================================

import React, { useRef, useEffect } from 'react'
import type { UploadFile, UploadConfig, UploadScenario } from '../types'
import { formatSize } from '../validator'
import { PRESET_META } from '../presets'

interface Props {
  isDragging: boolean
  dropZoneProps: Record<string, any>
  uploadingFiles: UploadFile[]
  onUpload: (files: FileList) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onCancelAll: () => void
  accept: string
  config: UploadConfig
  meta: { label: string; icon: string; desc: string }
  disabled?: boolean
}

const D = {
  purple: '#7c3aed',
  purpleLight: '#ede9fe',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
}

export const UploadZone: React.FC<Props> = ({
  isDragging, dropZoneProps, uploadingFiles, onUpload, onPause, onResume, onCancel, onCancelAll,
  accept, config, meta, disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (disabled) return
      const items = e.clipboardData?.files
      if (items?.length) onUpload(items)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [disabled, onUpload])

  const handleClick = () => { if (!disabled) inputRef.current?.click() }
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { onUpload(e.target.files); e.target.value = '' }
  }

  const hasUploading = uploadingFiles.length > 0

  return (
    <div>
      {/* Drop zone */}
      <div
        {...dropZoneProps}
        onClick={handleClick}
        style={{
          border: `2px dashed ${isDragging ? D.purple : D.gray200}`,
          borderRadius: 16,
          padding: hasUploading ? '20px 24px' : '40px 24px',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: isDragging
            ? `linear-gradient(135deg, ${D.purpleLight} 0%, #f5f3ff 100%)`
            : '#fff',
          transform: isDragging ? 'scale(1.01)' : 'scale(1)',
          transition: 'all .25s cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: disabled ? 0.5 : 1,
          boxShadow: isDragging
            ? `0 0 0 4px ${D.purpleLight}, 0 8px 24px rgba(124, 58, 237, 0.12)`
            : '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        {!hasUploading ? (
          <>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: isDragging ? D.purpleLight : D.gray100,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 12px', fontSize: 24,
              transition: 'all .25s',
            }}>
              {isDragging ? '📥' : '☁️'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: D.gray900, marginBottom: 4 }}>
              {isDragging ? '释放以上传文件' : '拖拽文件到此处或点击选择'}
            </div>
            <div style={{ fontSize: 13, color: D.gray400 }}>
              支持 {meta.label} — {config.accept.slice(0, 5).map(e => `.${e}`).join(', ')}{config.accept.length > 5 ? '...' : ''}
            </div>
            <div style={{ fontSize: 12, color: D.gray400, marginTop: 4 }}>
              最大 {formatSize(config.maxSize)} · 最多 {config.maxCount} 个文件 · <kbd style={kbdStyle}>⌘V</kbd> 粘贴上传
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: D.purpleLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              }}>
                📤
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: D.gray900 }}>
                  {uploadingFiles.length} 个文件上传中
                </div>
                <div style={{ fontSize: 11, color: D.gray400 }}>
                  点击继续添加 · 拖拽 · <kbd style={kbdStyle}>⌘V</kbd> 粘贴
                </div>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onCancelAll() }} style={cancelAllBtnStyle}>
              全部取消
            </button>
          </div>
        )}
      </div>

      <input ref={inputRef} type="file" multiple accept={accept} onChange={handleChange}
        style={{ display: 'none' }} />
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  padding: '1px 6px', fontSize: 10, fontFamily: 'monospace',
  background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 3,
  color: '#6b7280',
}

const cancelAllBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 500,
  border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer',
  color: '#dc2626', background: '#fff', transition: 'all .15s',
}