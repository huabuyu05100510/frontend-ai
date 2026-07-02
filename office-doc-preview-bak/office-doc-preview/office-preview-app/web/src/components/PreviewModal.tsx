import { useEffect } from 'react'
import type { Task } from '../types'
import { fileIcon, humanSize, formatTime } from '../types'
import { PreviewRouter } from '../previewers'
import { PerfPanel } from './PerfPanel'
import { usePerf } from '../perf'

interface Props {
  task: Task
  onClose: () => void
  onDownload: (t: Task) => void
}

export function PreviewModal({ task, onClose, onDownload }: Props) {
  // ESC 关闭 + 锁定滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // 注入转码指标到性能面板
  useEffect(() => {
    usePerf.getState().set({
      convertMs: task.convertDurationMs || 0,
      convertRetries: task.convertRetries || 0,
      convertEtaSec: task.convertEtaSec || 0,
      convertElapsedSec: task.convertElapsedSec || 0,
      previewSize: task.previewSize || 0,
      docSize: task.size || 0,
      ratio: task.previewSize && task.size ? task.previewSize / task.size : 0
    })
  }, [task])

  const downloading = task.convertStatus !== 'done' && task.strategy === 'convert_pdf'

  return (
    <div className="modal-mask" onMouseDown={onClose}>
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
            <a className="btn-mini" href={task.originalUrl} target="_blank" rel="noreferrer">
              原文件
            </a>
            <button className="btn-mini" onClick={() => onDownload(task)}>下载</button>
            <button className="btn-mini" onClick={onClose}>关闭 ✕</button>
          </div>
        </header>
        <div className="modal-body">
          {downloading ? (
            <div className="center-msg">
              <div className="spin" />
              <div style={{ marginTop: 12 }}>服务端转码中（{task.convertStatus}）…</div>
              <div className="hint">PPTX/XLSX 需经 LibreOffice 转 PDF，通常 5-30 秒。请稍候。</div>
            </div>
          ) : (
            <PreviewRouter task={task} />
          )}
        </div>
        <PerfPanel />
      </div>
    </div>
  )
}
