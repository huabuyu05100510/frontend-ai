// ============================================================
// UploadDemo — 极致体验设计
// ============================================================

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { UploadScenario, UploadFile } from '../types'
import { PRESETS, PRESET_META } from '../presets'
import { createOSSAdapter } from '../adapters/oss'
import { formatSize } from '../validator'
import { useUpload } from '../hooks/useUpload'
import { UploadZone } from './UploadZone'
import { FileCard } from './FileCard'
import { FileGallery } from './FileGallery'
import { ServerResponse } from './ServerResponse'
import { FilePreviewCard } from './FilePreviewCard'
import { ContentPreview } from './ContentPreview'
import { ComparisonView } from './ComparisonView'
import type { HttpProtocol } from '../http-strategies'
import { ProtocolInfo } from '../http-strategies'
import type { FilePreview as FilePreviewData } from '../preview'
import { generatePreview } from '../preview'

const SCENARIOS: UploadScenario[] = ['universal', 'document', 'image', 'audio', 'video', 'ai-image']
const PROTOCOLS: Array<{ id: HttpProtocol; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'http1', label: 'HTTP/1.1' },
  { id: 'http2', label: 'HTTP/2' },
  { id: 'http3', label: 'HTTP/3' },
]
const PROTOCOL_DISPLAY: Record<HttpProtocol, string> = {
  auto: 'HTTP/2',
  http1: 'HTTP/1.1',
  http2: 'HTTP/2',
  http3: 'HTTP/3',
}

// ---- Design Tokens ----
const D = {
  purple: '#7c3aed',
  purpleDark: '#5b21b6',
  purpleLight: '#ede9fe',
  green: '#059669',
  greenBg: '#ecfdf5',
  red: '#dc2626',
  redBg: '#fef2f2',
  blue: '#2563eb',
  amber: '#d97706',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
}

export const UploadDemo: React.FC = () => {
  const [view, setView] = useState<'upload' | 'compare'>('upload')
  const [active, setActive] = useState<UploadScenario>('universal')
  const [protocol, setProtocol] = useState<HttpProtocol>('auto')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [previewingFile, setPreviewingFile] = useState<UploadFile | null>(null)
  const [previewCache, setPreviewCache] = useState<Map<string, FilePreviewData>>(new Map())
  const galleryRef = useRef<HTMLDivElement>(null)

  const [useOSS, setUseOSS] = useState(false)
  const ossAdapter = useMemo(() => createOSSAdapter({
    policyUrl: 'http://localhost:5180/api/oss/policy',
    signGetUrl: 'http://localhost:5180/api/oss/sign-get',
  }), [])

  const config = useMemo(
    () => ({ ...PRESETS[active], ...(useOSS ? { adapter: ossAdapter } : {}) }),
    [active, useOSS, ossAdapter],
  )
  const meta = PRESET_META[active]
  const { files, upload, pause, resume, cancel, cancelAll, clearCompleted, isDragging, dropZoneProps, metrics, connState } = useUpload(config)

  const acceptAll = config.accept.includes('*')
  const acceptStr = acceptAll ? '' : config.accept.map(ext => `.${ext}`).join(',')

  // 注：移除了上传完成后的 scrollIntoView 自动平滑滚动 —— 它会在高频进度更新时
  // 反复触发页面滚动动画，造成明显抖动。改为不自动滚动，由用户掌控视图。

  const completedFiles = files.filter(f => f.status === 'done' || f.status === 'instant')
  const uploadingFiles = files.filter(f => !['done', 'instant', 'cancelled', 'failed'].includes(f.status))

  const selectedFile = files.find(f => f.id === selectedFileId) ?? null

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList)
    // 预生成预览（异步不阻塞上传）
    for (const f of arr) {
      generatePreview(f).then(p => {
        setPreviewCache(prev => new Map(prev).set(`${f.name}_${f.size}`, p))
      })
    }
    upload(arr)
  }, [upload])

  const latestFile = files[files.length - 1] ?? null

  return (
    <div style={styles.shell}>
      {/* ========== Header ========== */}
      <header style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.brandIcon}>⚡</div>
          <div>
            <div style={styles.brandTitle}>Upload Engine</div>
            <div style={styles.brandSub}>CDC · 零知识加密 · Delta · WebTransport · 极致体验</div>
          </div>
        </div>

        <div style={styles.viewSwitch}>
          <button onClick={() => setView('upload')} style={styles.viewBtn(view === 'upload')}>上传</button>
          <button onClick={() => setView('compare')} style={styles.viewBtn(view === 'compare')}>性能对比</button>
        </div>

        {view === 'upload' && (
          <nav style={styles.nav}>
            {SCENARIOS.map(s => (
              <button key={s} onClick={() => setActive(s)} style={styles.navBtn(active === s)}>
                <span>{PRESET_META[s].icon}</span>
                <span>{PRESET_META[s].label}</span>
              </button>
            ))}
          </nav>
        )}

        <div style={{ flex: 1 }} />

        {view === 'upload' && (
        <div style={styles.protoSelector}>
          {PROTOCOLS.map(p => (
            <button key={p.id} onClick={() => setProtocol(p.id)} style={styles.protoBtn(protocol === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        )}

        {view === 'upload' && (
        <button
          onClick={() => setUseOSS(v => !v)}
          title="开启后走阿里云 OSS PostObject 直传（需先 npm run dev:oss 并配置 .env）"
          style={{
            padding: '6px 12px', border: `1.5px solid ${useOSS ? D.green : D.gray300}`,
            borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: useOSS ? D.greenBg : '#fff', color: useOSS ? D.green : D.gray500,
            display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: useOSS ? D.green : D.gray300,
          }} />
          直传 OSS
        </button>
        )}

              </header>

      {/* ========== Compare view ========== */}
      {view === 'compare' && (
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable' }}>
          <ComparisonView />
        </div>
      )}

      {/* ========== Body ========== */}
      {view === 'upload' && (
      <div style={styles.body}>
        {/* Main column */}
        <div style={styles.mainCol}>
          {/* Upload zone */}
          <UploadZone
            isDragging={isDragging}
            dropZoneProps={dropZoneProps}
            uploadingFiles={uploadingFiles}
            onUpload={handleFiles}
            onPause={pause}
            onResume={resume}
            onCancel={cancel}
            onCancelAll={cancelAll}
            accept={acceptStr}
            config={config}
            meta={meta}
          />

          {/* Empty state */}
          {uploadingFiles.length === 0 && completedFiles.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '60px 20px', color: D.gray400,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            }}>
              <div style={{ fontSize: 48, opacity: 0.4 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: D.gray500 }}>选择场景，拖拽或粘贴文件开始上传</div>
              <div style={{ fontSize: 12 }}>
                支持 {meta.label} · {acceptAll ? '任意格式（图片自动压缩）' : config.accept.slice(0, 5).map(e => `.${e}`).join(', ') + (config.accept.length > 5 ? '...' : '')}
              </div>
            </div>
          )}

          {/* Uploading files */}
          {uploadingFiles.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionTitle}>上传中</span>
                <span style={styles.badge}>{uploadingFiles.length}</span>
              </div>
              <div style={styles.fileGrid}>
                {uploadingFiles.map(f => (
                  <FileCard
                    key={f.id}
                    file={f}
                    preview={previewCache.get(`${f.name}_${f.size}`)}
                    onPause={() => pause(f.id)}
                    onResume={() => resume(f.id)}
                    onCancel={() => cancel(f.id)}
                    onSelect={() => setSelectedFileId(f.id)}
                    isSelected={f.id === selectedFileId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Completed files gallery */}
          {completedFiles.length > 0 && (
            <div ref={galleryRef} style={styles.section}>
              <FileGallery
                files={completedFiles}
                previews={previewCache}
                onSelect={id => {
                  const f = completedFiles.find(x => x.id === id)
                  if (f) setPreviewingFile(f)
                }}
                selectedId={selectedFileId}
                onClear={() => {
                  clearCompleted()
                  setSelectedFileId(null)
                }}
              />
            </div>
          )}

          {/* Failed files */}
          {files.filter(f => f.status === 'failed').length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <span style={{ ...styles.sectionTitle, color: D.red }}>失败</span>
                <span style={{ ...styles.badge, background: D.redBg, color: D.red }}>
                  {files.filter(f => f.status === 'failed').length}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div style={styles.sideCol}>
          {/* Preview card */}
          {selectedFile && (
            <FilePreviewCard
              file={selectedFile}
              preview={previewCache.get(`${selectedFile.name}_${selectedFile.size}`)}
              onClose={() => setSelectedFileId(null)}
            />
          )}

          {/* Server response */}
          <ServerResponse
            file={selectedFile ?? latestFile}
            responseData={selectedFile?.status === 'done' || selectedFile?.status === 'instant' ? {
              url: selectedFile.url ?? undefined,
              instant: selectedFile.status === 'instant',
              merged: selectedFile.chunks.length > 0,
              merkleVerified: selectedFile.hash != null,
              merkleRoot: selectedFile.hash ?? undefined,
              chunkCount: selectedFile.chunks.length,
              protocol: PROTOCOL_DISPLAY[protocol],
              requestId: crypto.randomUUID(),
              encrypted: false,
            } : undefined}
            protocolMetrics={selectedFile && metrics ? {
              protocol: PROTOCOL_DISPLAY[protocol],
              concurrency: metrics.concurrency,
              duration: metrics.totalDuration,
              throughput: metrics.speed,
            } : undefined}
          />

          {/* Performance panel */}
          <PerfPanel connState={connState} metrics={metrics} />
        </div>
      </div>
      )}

      {/* Content preview modal — 从服务端加载 */}
      {previewingFile && (
        <ContentPreview
          file={previewingFile}
          onClose={() => setPreviewingFile(null)}
        />
      )}
    </div>
  )
}

// ============================================================
// PerfPanel
// ============================================================
function PerfPanel({ connState, metrics }: { connState: any; metrics: any }) {
  return (
    <div style={styles.perfCard}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: D.gray900 }}>📡 性能面板</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: D.gray400, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>连接</div>
        <MiniMetric label="并发数" value={connState.concurrency} />
        <MiniMetric label="EWMA 延迟" value={`${connState.ewmaLatency}ms`} />
        <MiniMetric label="成功率" value={`${(connState.successRate * 100).toFixed(1)}%`}
          color={connState.successRate < 0.8 ? D.red : D.green} />
      </div>

      {metrics && (
        <div>
          <div style={{ fontSize: 11, color: D.gray400, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>指标</div>
          <MiniMetric label="文件" value={formatSize(metrics.fileSize)} />
          <MiniMetric label="分片" value={`${metrics.chunkCount} × ${formatSize(metrics.chunkSize)}`} />
          <MiniMetric label="总耗时" value={`${(metrics.totalDuration / 1000).toFixed(1)}s`} />
          <MiniMetric label="速度" value={formatSize(metrics.speed) + '/s'} />
          <MiniMetric label="P95" value={`${metrics.p95ChunkLatency}ms`} />
          <MiniMetric label="重试" value={metrics.retryCount} color={metrics.retryCount > 0 ? D.amber : D.green} />
          <MiniMetric label="熔断" value={metrics.circuitBreakerTrips} color={metrics.circuitBreakerTrips > 0 ? D.red : D.green} />
          <MiniMetric label="网络" value={metrics.networkType?.toUpperCase()} />
        </div>
      )}
    </div>
  )
}

function MiniMetric({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: 12 }}>
      <span style={{ color: D.gray400 }}>{label}</span>
      <span style={{ fontWeight: 500, color: color ?? D.gray700, fontFamily: 'monospace', fontSize: 11 }}>{value}</span>
    </div>
  )
}

// ============================================================
// Styles
// ============================================================
const styles: Record<string, any> = {
  shell: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
    background: D.gray50, color: D.gray900,
  },

  header: {
    background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 20,
    borderBottom: `1px solid ${D.gray200}`, flexShrink: 0, height: 56,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },

  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  brandIcon: { fontSize: 22, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: D.purpleLight, borderRadius: 10 },
  brandTitle: { fontSize: 15, fontWeight: 700, color: D.gray900, lineHeight: 1.2 },
  brandSub: { fontSize: 10, color: D.gray400, lineHeight: 1, display: 'none' },

  viewSwitch: { display: 'flex', gap: 2, background: D.gray100, borderRadius: 8, padding: 2 },
  viewBtn: (active: boolean) => ({
    padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 700 : 500,
    background: active ? D.purple : 'transparent',
    color: active ? '#fff' : D.gray500,
    transition: 'all .15s',
  }),

  nav: { display: 'flex', gap: 2, background: D.gray100, borderRadius: 8, padding: 2 },
  navBtn: (active: boolean) => ({
    padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? '#fff' : 'transparent',
    color: active ? D.gray900 : D.gray500,
    display: 'flex', alignItems: 'center', gap: 6,
    transition: 'all .15s', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
  }),

  protoSelector: { display: 'flex', gap: 2, background: D.gray100, borderRadius: 6, padding: 2 },
  protoBtn: (active: boolean) => ({
    padding: '4px 10px', border: 'none', borderRadius: 4, cursor: 'pointer',
    fontSize: 11, fontWeight: active ? 600 : 400,
    background: active ? '#fff' : 'transparent',
    color: active ? D.gray900 : D.gray500,
    transition: 'all .15s',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
  }),

  body: {
    flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', gap: 20, padding: 20,
    scrollbarGutter: 'stable',
  },

  mainCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 },

  sideCol: {
    width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12,
  },

  section: { display: 'flex', flexDirection: 'column', gap: 10 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: D.gray900 },
  badge: { fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: D.gray100, color: D.gray500 },

  fileGrid: { display: 'flex', flexDirection: 'column', gap: 6 },

  perfCard: {
    background: '#fff', borderRadius: 12, padding: 16,
    border: `1px solid ${D.gray200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
}

