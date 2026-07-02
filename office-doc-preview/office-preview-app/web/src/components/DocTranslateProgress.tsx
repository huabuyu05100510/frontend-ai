// 模型：claude-sonnet-4-6
// DocTranslateProgress — Progress ring + ETA + glossaryHits/tmHits chips + cancel + partial export

import { ProgressRing } from './ProgressRing'

export type DocTranslateStatus = 'idle' | 'started' | 'running' | 'finished' | 'failed' | 'cancelled'

export interface DocTranslateProgressProps {
  jobId: string | null
  status: DocTranslateStatus
  percent: number
  eta: string
  completed: number
  total: number
  glossaryHits: number
  tmHits: number
  error: string | null
  onCancel: () => void
  onExportPartial: () => void
}

const STATUS_TEXT: Record<DocTranslateStatus, string> = {
  idle: '准备中',
  started: '启动中',
  running: '翻译中',
  finished: '完成',
  failed: '失败',
  cancelled: '已取消',
}

export function DocTranslateProgress(props: DocTranslateProgressProps) {
  const { jobId, status, percent, eta, completed, total, glossaryHits, tmHits, error, onCancel, onExportPartial } = props
  const isTerminal = status === 'finished' || status === 'failed' || status === 'cancelled'
  const isRunning = status === 'running' || status === 'started'

  return (
    <div className="xf-doc-translate-progress" data-testid="doc-translate-progress">
      <div className="xf-doc-translate-progress-main">
        <ProgressRing percent={percent} aria-label={`翻译进度 ${Math.round(percent)}%`} />
        <div className="xf-doc-translate-progress-meta">
          <div className="xf-doc-translate-progress-row">
            <span className="xf-doc-translate-progress-status" data-testid="doc-translate-status-text">
              {STATUS_TEXT[status] ?? '—'}
            </span>
            <span className="xf-doc-translate-progress-percent" data-testid="doc-translate-progress-percent">
              {Math.round(percent)}%
            </span>
          </div>
          <div className="xf-doc-translate-progress-row">
            <span className="xf-doc-translate-progress-eta" data-testid="doc-translate-progress-eta">ETA {eta}</span>
            <span className="xf-doc-translate-progress-counter" data-testid="doc-translate-progress-completed">
              {completed}/{total} 页
            </span>
          </div>
          <div className="xf-doc-translate-progress-row">
            <span className="xf-doc-translate-chip" data-testid="doc-translate-glossary-hits">
              术语表 {glossaryHits}
            </span>
            <span className="xf-doc-translate-chip" data-testid="doc-translate-tm-hits">
              记忆库 {tmHits}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="xf-doc-translate-progress-error" data-testid="doc-translate-error">
          {error}
        </div>
      )}

      <div className="xf-doc-translate-progress-actions">
        {isRunning && (
          <button
            className="xf-btn"
            onClick={onExportPartial}
            data-testid="doc-translate-export-partial"
            type="button"
          >
            导出已完成部分
          </button>
        )}
        {!isTerminal && jobId && (
          <button
            className="xf-btn xf-btn-danger"
            onClick={onCancel}
            data-testid="doc-translate-cancel"
            type="button"
          >
            取消
          </button>
        )}
      </div>
    </div>
  )
}
