import { memo } from 'react'
import type { Task } from '../types'
import { humanSize, formatTime, fileIcon, previewKindOf } from '../types'

interface Props {
  task: Task
  onPreview: (t: Task) => void
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  done: { label: '可预览', cls: 'ok' },
  processing: { label: '转码中', cls: 'busy' },
  pending: { label: '排队中', cls: 'busy' },
  retrying: { label: '重试中', cls: 'busy' },
  failed: { label: '转码失败', cls: 'fail' }
}

function TaskCardBase({ task, onPreview }: Props) {
  const kind = previewKindOf(task)
  const st = STATUS_META[task.convertStatus] || STATUS_META.done
  const previewable = st.label === '可预览' || task.strategy === 'frontend'
  const icon = fileIcon(task.ext)

  return (
    <div className={`card ${previewable ? '' : 'card-busy'}`}>
      <div className={`card-icon icon-${task.ext.slice(0, 4)}`}>{icon}</div>
      <div className="card-body">
        <div className="card-name" title={task.name}>{task.name}</div>
        <div className="card-meta">
          <span className="chip chip-kind">{kindLabel(kind)}</span>
          <span className="chip">{humanSize(task.size)}</span>
          <span className={`chip chip-status ${st.cls}`}>{st.label}</span>
        </div>
        <div className="card-time">{formatTime(task.createdAt)}</div>
        {task.convertStatus === 'failed' && task.convertError && (
          <div className="card-err" title={task.convertError}>转码失败：{task.convertError.slice(0, 40)}</div>
        )}
      </div>
      <div className="card-actions">
        <button
          className="btn-primary"
          disabled={!previewable}
          onClick={() => onPreview(task)}
        >
          预览
        </button>
      </div>
    </div>
  )
}

function kindLabel(k: string) {
  return ({ pdf: 'PDF', docx: 'DOCX', image: '图片', audio: '音频', video: '视频', text: '文本', unsupported: '未知' } as any)[k] || k
}

export const TaskCard = memo(TaskCardBase)
