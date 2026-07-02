// 颜色迁移至 semantic.ts (Phase 2.A)
// PreviewModal — 文件预览弹层（PDF / 图片 / WASM）
// 模型：claude-sonnet-4-6
// Phase 2.A: 套用 Modal primitive 提供 focus-trap / esc / animate；保留 .modal-mask / .modal 原 CSS
import { useEffect, useState } from 'react'
import type { Task } from '../types'
import { fileIcon, humanSize, formatTime, stageLabel } from '../types'
import { PreviewRouter } from '../previewers'
import { PerfPanel } from './PerfPanel'
import { usePerf } from '../perf'
import { Modal, type ModalCloseReason } from './Modal'

type Mode = 'auto' | 'pdf' | 'images' | 'wasm'

const LS_KEY = 'previewMode'

function readPersistedMode(): Mode {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v === 'pdf' || v === 'images' || v === 'wasm') return v
  } catch {}
  return 'auto'
}

function persistMode(m: Mode) {
  try { if (m !== 'auto') localStorage.setItem(LS_KEY, m); else localStorage.removeItem(LS_KEY) } catch {}
}

function resolveMode(m: Mode, hasPages: boolean): 'pdf' | 'images' | 'wasm' {
  if (m === 'wasm') return 'wasm'
  if (m === 'pdf') return 'pdf'
  if (m === 'images') return 'images'
  return hasPages ? 'images' : 'pdf'
}

interface Props {
  task: Task
  onClose: () => void
  onDownload: (t: Task) => void
}

export function PreviewModal({ task, onClose, onDownload }: Props) {
  const [mode, setMode] = useState<Mode>(() => readPersistedMode())
  const hasPages = !!(task.pages && task.pages.length > 0)
  const resolved = resolveMode(mode, hasPages)

  useEffect(() => {
    usePerf.getState().set({
      convertMs: task.convertDurationMs || 0,
      convertRetries: task.convertRetries || 0,
      convertEtaSec: task.convertEtaSec || 0,
      convertElapsedSec: task.convertElapsedSec || 0,
      rasterizeMs: task.convertRasterizeMs || 0,
      previewSize: task.previewSize || 0,
      docSize: task.size || 0,
      ratio: task.previewSize && task.size ? task.previewSize / task.size : 0
    })
  }, [task])

  const downloading = task.convertStatus !== 'done' && task.strategy === 'convert_pdf'
  const stage = task.convertStage
  const progressPct = task.pagesTotal && task.pagesTotal > 0
    ? Math.min(100, Math.round(((task.pagesDone || 0) / task.pagesTotal) * 100))
    : null

  const handleClose = (_reason: ModalCloseReason) => {
    onClose()
  }

  return (
    <Modal
      open={true}
      onClose={handleClose}
      width="xl"
      maskClosable={true}
      bare
      className="preview-modal-host"
      ariaLabelledBy={undefined}
    >
      <div className="modal-mask" onMouseDown={() => onClose()}>
        <div className="modal" onMouseDown={e => e.stopPropagation()}>
          <header className="modal-header">
            <div className="modal-title" title={task.name}>
              <span className={`modal-icon icon-${task.ext.slice(0, 4)}`}>{fileIcon(task.ext)}</span>
              <div className="modal-name">{task.name}</div>
            </div>
            <div className="modal-meta">
              <span>{humanSize(task.size)}</span>
              <span>·</span>
              <span>{formatTime(task.createdAt)}</span>
            </div>
            <div className="modal-actions">
              {(hasPages || resolved === 'wasm') && (
                <div className="mode-toggle" role="group" aria-label="预览模式">
                  <button
                    className={`btn-mini ${resolved === 'pdf' ? 'is-active' : ''}`}
                    aria-pressed={resolved === 'pdf'}
                    onClick={() => { setMode('pdf'); persistMode('pdf') }}
                    title="使用 pdf.js 高保真渲染"
                  >
                    PDF 模式
                  </button>
                  {hasPages && (
                    <button
                      className={`btn-mini ${resolved === 'images' ? 'is-active' : ''}`}
                      aria-pressed={resolved === 'images'}
                      onClick={() => { setMode('images'); persistMode('images') }}
                      title="使用服务端栅格化图片+文字层（更快，可选可复制）"
                    >
                      图片+文字
                    </button>
                  )}
                  <button
                    className={`btn-mini ${resolved === 'wasm' ? 'is-active' : ''}`}
                    aria-pressed={resolved === 'wasm'}
                    onClick={() => { setMode('wasm'); persistMode('wasm') }}
                    title="pdfium WASM（最佳性能，需 crossOriginIsolated）"
                  >
                    WASM
                  </button>
                </div>
              )}
              <a className="btn-mini" href={task.originalUrl} target="_blank" rel="noreferrer">
                原文件
              </a>
              <button className="btn-mini" onClick={() => onDownload(task)}>下载</button>
              <button className="btn-mini" onClick={() => onClose()}>关闭 ✕</button>
            </div>
          </header>
          <div className="modal-body">
            {downloading ? (
              <div className="center-msg">
                <div className="spin" />
                <div style={{ marginTop: 12 }}>
                  服务端转码中（{task.convertStatus}）
                  {stage && <> · {stageLabel(stage)}</>}
                </div>
                {progressPct != null && (
                  <div className="progress">
                    <div className="progress-bar" style={{ width: progressPct + '%' }} />
                    <div className="progress-text">
                      页面 {task.pagesDone || 0} / {task.pagesTotal}（{progressPct}%）
                    </div>
                  </div>
                )}
                <div className="hint">OnlyOffice 转 PDF + 服务端栅格化。</div>
              </div>
            ) : (
              <PreviewRouter task={task} mode={resolved} />
            )}
          </div>
          <PerfPanel />
        </div>
      </div>
    </Modal>
  )
}