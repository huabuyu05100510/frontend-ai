// 颜色迁移至 semantic.ts (Phase 2.A)
// UploadCenterPage — 上传中心（AI 能力）
// 模型：claude-sonnet-4-6
//
// 集成 v3/upload-engine 内核：
//   - 6 个预设场景（universal / document / image / audio / video / ai-image）
//   - SmartUploader 七层管道：魔数→自适应分片→流式哈希→断路器→并发→上传→Merkle
//   - 图片：EXIF 矫正 + 压缩（AVIF/WebP 自适应）
//   - 秒传：服务端 hash 索引命中
//   - 断点续传：localStorage 持久化已上传分片
//
// 端点（与 presets.ts 的 API 对象对齐）：
//   POST /api/upload         (directUpload，已存在，补充返回 url 字段)
//   POST /api/upload/check   (秒传检查)
//   POST /api/upload/chunk   (分片接收)
//   POST /api/upload/merge   (合并 + 触发转换)
//   GET  /api/upload/history (上传历史)
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useUpload } from '../upload-engine/hooks/useUpload'
import { UploadZone } from '../upload-engine/components/UploadZone'
import { FileCard } from '../upload-engine/components/FileCard'
import { PRESETS, PRESET_META } from '../upload-engine/presets'
import type { UploadScenario, UploadConfig } from '../upload-engine/types'
import { useStore } from '../store'
import { UploadIcon, HistoryIcon } from '../design/icons'
import { humanSize, formatTime } from '../types'

const SCENARIOS: UploadScenario[] = ['universal', 'document', 'image', 'audio', 'video', 'ai-image']

/** 上传历史条目（来自 GET /api/upload/history） */
interface HistoryItem {
  id: string
  name: string
  ext: string
  size: number
  status: string
  convertStatus?: string
  createdAt: number
  previewUrl: string | null
  originalUrl: string
}

export function UploadCenterPage() {
  const [scenario, setScenario] = useState<UploadScenario>('universal')
  const fetchTasks = useStore(s => s.fetchTasks)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // 当前 preset 配置（可直接使用，URLs 已对齐）
  const config: UploadConfig = useMemo(() => PRESETS[scenario], [scenario])

  const {
    files, upload, pause, resume, cancel, cancelAll, clearCompleted,
    isDragging, dropZoneProps,
  } = useUpload(config)

  // accept 属性（input 用）
  const acceptStr = useMemo(() => {
    if (config.accept.includes('*')) return ''
    return config.accept.map(e => '.' + e).join(',')
  }, [config.accept])

  const meta = PRESET_META[scenario]

  // 拉取历史
  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const r = await fetch('/api/upload/history', { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setHistory(d.items || [])
      }
    } catch (e) {
      console.warn('[history] fetch failed', e)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { refreshHistory() }, [refreshHistory])

  // 有文件完成时刷新历史 + 任务列表
  const doneCount = files.filter(f => f.status === 'done' || f.status === 'instant').length
  const prevDoneRef = useState({ count: 0 })[0]
  useEffect(() => {
    if (doneCount > prevDoneRef.count) {
      // 触发历史与全局任务列表刷新
      refreshHistory()
      fetchTasks()
    }
    prevDoneRef.count = doneCount
  }, [doneCount, refreshHistory, fetchTasks, prevDoneRef])

  // 历史筛选：按当前 preset 的 accept 过滤（universal 不过滤）
  const filteredHistory = useMemo(() => {
    if (config.accept.includes('*')) return history
    return history.filter(h => config.accept.includes(h.ext.toLowerCase()))
  }, [history, config.accept])

  // 统计
  const activeCount = files.filter(f => !['done', 'instant', 'cancelled', 'failed'].includes(f.status)).length
  const successCount = files.filter(f => f.status === 'done' || f.status === 'instant').length
  const failedCount = files.filter(f => f.status === 'failed').length

  return (
    <div className="xf-workspace" data-testid="upload-center-page">
      <div className="xf-submenu">
        {SCENARIOS.map(s => {
          const m = PRESET_META[s]
          return (
            <button
              key={s}
              className={`xf-submenu-item${scenario === s ? ' active' : ''}`}
              onClick={() => setScenario(s)}
              data-testid={`uc-scenario-${s}`}
              title={m.desc}
            >
              <span style={{ marginRight: 8 }}>{m.icon}</span>
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="xf-content" style={{ padding: 24 }} data-testid="uc-content">
        {/* 场景说明 */}
        <div className="oa-card" style={{
          padding: '14px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'linear-gradient(135deg, var(--color-ai-bg) 0%, var(--color-primary-bg) 100%)',
        }}>
          <UploadIcon size={20} style={{ color: 'var(--color-ai)' }} />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
              {meta.icon} {meta.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{meta.desc}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            <span>📦 最大 {humanSize(config.maxSize)}</span>
            <span>🔢 ≤ {config.maxCount} 个</span>
            {config.chunkSize > 0 && <span>✂️ 分片 {humanSize(config.chunkSize)}</span>}
            {config.compress && <span>🖼️ 压缩</span>}
            <span>⚡ 并发 ×{config.concurrent}</span>
          </div>
        </div>

        {/* 上传区 */}
        <div style={{ marginBottom: 16 }}>
          <UploadZone
            isDragging={isDragging}
            dropZoneProps={dropZoneProps}
            uploadingFiles={files}
            onUpload={(fl) => upload(fl)}
            onPause={pause}
            onResume={resume}
            onCancel={cancel}
            onCancelAll={cancelAll}
            accept={acceptStr}
            config={config}
            meta={meta}
          />
        </div>

        {/* 活跃上传 + 状态摘要 */}
        {files.length > 0 && (
          <div className="oa-card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>📤 本次上传（{files.length}）</span>
              {activeCount > 0 && <span style={{ fontSize: 12, color: 'var(--color-primary)' }}>进行中 {activeCount}</span>}
              {successCount > 0 && <span style={{ fontSize: 12, color: 'var(--color-success)' }}>成功 {successCount}</span>}
              {failedCount > 0 && <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>失败 {failedCount}</span>}
              <div style={{ flex: 1 }} />
              <button className="oa-btn oa-btn-ghost oa-btn-sm" onClick={clearCompleted}>清除已完成</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {files.map(f => (
                <FileCard
                  key={f.id}
                  file={f}
                  onPause={() => pause(f.id)}
                  onResume={() => resume(f.id)}
                  onCancel={() => cancel(f.id)}
                  onSelect={() => {}}
                  isSelected={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* 上传历史 */}
        <div className="oa-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <HistoryIcon size={16} style={{ color: 'var(--color-text-tertiary)' }} />
            <span style={{ fontWeight: 600 }}>📜 上传历史</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {filteredHistory.length} 条
              {!config.accept.includes('*') && ` （已按 ${meta.label} 过滤）`}
            </span>
            {historyLoading && <span className="xf-loading" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
            <div style={{ flex: 1 }} />
            <button className="oa-btn oa-btn-ghost oa-btn-sm" onClick={refreshHistory} title="刷新">🔄 刷新</button>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="xf-empty" style={{ padding: 32 }}>
              <div className="xf-empty-icon">📭</div>
              <div className="xf-empty-title">暂无上传历史</div>
              <div className="xf-empty-desc">完成上传后将在此显示</div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
              maxHeight: '50vh', overflow: 'auto',
            }} data-testid="uc-history-grid">
              {filteredHistory.map(h => {
                const url = h.previewUrl || h.originalUrl
                const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(h.ext.toLowerCase())
                const isDone = h.convertStatus === 'done' || h.status === 'ready'
                const isProcessing = ['pending', 'processing', 'rasterizing', 'retrying'].includes(h.convertStatus || '')
                return (
                  <a
                    key={h.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="uc-history-item"
                    style={{
                      border: '1px solid var(--color-border-light)', borderRadius: 8, overflow: 'hidden',
                      background: '#fff', textDecoration: 'none', color: 'inherit',
                      transition: 'transform 200ms, box-shadow 200ms',
                      display: 'flex', flexDirection: 'column',
                    }}
                    className="uc-history-card"
                    title={h.name}
                  >
                    {/* 缩略图 */}
                    <div style={{
                      height: 120, background: 'var(--color-bg-subtle)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      position: 'relative',
                    }}>
                      {isImage ? (
                        <img src={h.originalUrl} alt={h.name} loading="lazy"
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      ) : (
                        <span style={{ fontSize: 36 }}>{extEmoji(h.ext)}</span>
                      )}
                      {/* 状态角标 */}
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: isProcessing ? 'var(--color-warning-bg)' : isDone ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
                        color: isProcessing ? 'var(--color-warning)' : isDone ? 'var(--color-success)' : 'var(--color-danger)',
                      }}>
                        {isProcessing ? '转码中' : isDone ? '✓ 就绪' : '失败'}
                      </span>
                    </div>
                    {/* 信息 */}
                    <div style={{ padding: '8px 10px', flex: 1 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 500, color: 'var(--color-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{h.name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        <span>{h.ext.toUpperCase()} · {humanSize(h.size)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-placeholder)', marginTop: 2 }}>
                        {formatTime(h.createdAt)}
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function extEmoji(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return '📕'
  if (['docx', 'doc'].includes(e)) return '📘'
  if (['pptx', 'ppt'].includes(e)) return '📗'
  if (['xlsx', 'xls'].includes(e)) return '📊'
  if (['mp3', 'wav', 'm4a', 'aac'].includes(e)) return '🎵'
  if (['mp4', 'mov', 'mkv', 'flv', 'webm'].includes(e)) return '🎬'
  if (['txt', 'md'].includes(e)) return '📄'
  return '📦'
}
