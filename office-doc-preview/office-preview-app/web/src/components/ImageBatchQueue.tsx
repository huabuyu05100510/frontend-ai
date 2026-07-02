// ImageBatchQueue — 多选图片 + 批量翻译队列
// 模型：claude-sonnet-4-6
import React from 'react'
import type { Task, ImageBatchItem, BatchStatus } from '../types'

interface Props {
  open: boolean
  tasks: Task[]
  selectedTaskIds: string[]
  jobId: string | null
  status: BatchStatus
  items: ImageBatchItem[]
  onClose: () => void
  onToggleTask: (taskId: string) => void
  onStart: () => void
  onCancel: () => void
}

const STATUS_LABEL: Record<BatchStatus, string> = {
  idle: '未开始',
  started: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const ITEM_STATUS_LABEL: Record<ImageBatchItem['status'], string> = {
  pending: '待处理',
  'ocr-done': 'OCR 完成',
  'image-done': '出图完成',
  failed: '失败',
}

const ITEM_STATUS_COLOR: Record<ImageBatchItem['status'], string> = {
  pending: 'var(--color-text-tertiary)',
  'ocr-done': 'var(--color-info)',
  'image-done': 'var(--color-success)',
  failed: 'var(--color-danger)',
}

/**
 * 批量翻译队列 UI
 * - 多选 task / 启动 / 取消
 * - 实时状态 pills (per item)
 * - 整体状态徽章 (idle / running / completed / cancelled)
 */
export function ImageBatchQueue({
  open,
  tasks,
  selectedTaskIds,
  jobId,
  status,
  items,
  onClose,
  onToggleTask,
  onStart,
  onCancel,
}: Props) {
  if (!open) return null

  const itemById = new Map(items.map(it => [it.taskId, it]))

  return (
    <div
      data-testid="image-batch-queue"
      role="dialog"
      aria-label="批量图片翻译"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-bg-mask)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: '90vw',
          maxHeight: '80vh',
          background: 'var(--color-bg)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            批量图片翻译
          </div>
          <span
            data-testid="batch-status"
            data-status={status}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: status === 'running' ? 'var(--color-primary-bg)' :
                status === 'completed' ? 'var(--color-success-bg)' :
                status === 'failed' || status === 'cancelled' ? 'var(--color-danger-bg)' :
                'var(--color-bg-subtle)',
              color: status === 'running' ? 'var(--color-primary)' :
                status === 'completed' ? 'var(--color-success)' :
                status === 'failed' || status === 'cancelled' ? 'var(--color-danger)' :
                'var(--color-text-tertiary)',
            }}
          >
            {STATUS_LABEL[status]} {jobId ? `· ${jobId.slice(0, 8)}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button
            data-testid="batch-close"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
            aria-label="关闭"
          >✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tasks.map(t => {
              const checked = selectedTaskIds.includes(t.id)
              const item = itemById.get(t.id)
              const statusLabel: string | null = item ? ITEM_STATUS_LABEL[item.status] : null
              const statusColor: string | null = item ? (ITEM_STATUS_COLOR[item.status] as string) : null
              return (
                <div
                  key={t.id}
                  data-testid={`batch-task-${t.id}`}
                  data-selected={checked}
                  onClick={() => onToggleTask(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px',
                    background: checked ? 'var(--color-primary-bg)' : 'var(--color-bg-subtle)',
                    border: '1px solid ' + (checked ? 'var(--color-primary)' : 'var(--color-border-light)'),
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleTask(t.id)}
                    onClick={e => e.stopPropagation()}
                    aria-label={`选择 ${t.name}`}
                  />
                  <span style={{ flex: 1, color: 'var(--color-text)' }}>{t.name}</span>
                  {statusLabel && (
                    <span
                      data-testid={`batch-item-status-${t.id}`}
                      style={{
                        fontSize: 10, padding: '1px 8px', borderRadius: 8,
                        background: 'var(--color-bg)', color: statusColor ?? undefined,
                        border: `1px solid ${statusColor ?? 'var(--color-border)'}`,
                      }}
                    >
                      {statusLabel}{item?.percent !== undefined ? ` ${item.percent}%` : ''}
                    </span>
                  )}
                </div>
              )
            })}
            {tasks.length === 0 && (
              <div style={{ color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 24, fontSize: 13 }}>
                暂无可批量翻译的图片任务
              </div>
            )}
          </div>

          <div data-testid="batch-items" style={{ display: 'none' }}>
            {/* 用于测试断言：渲染 items 包含 taskId */}
            {items.map(it => (
              <span key={it.taskId} data-taskid={it.taskId}>{it.taskId}</span>
            ))}
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            已选 {selectedTaskIds.length} / {tasks.length}
          </span>
          <span style={{ flex: 1 }} />
          {(status === 'idle' || status === 'failed' || status === 'cancelled' || status === 'completed') && (
            <button
              data-testid="batch-start"
              onClick={onStart}
              disabled={selectedTaskIds.length === 0}
              style={{
                padding: '6px 16px',
                fontSize: 13, fontWeight: 500,
                background: selectedTaskIds.length === 0 ? 'var(--color-bg-subtle)' : 'var(--color-primary)',
                color: selectedTaskIds.length === 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-inverse)',
                border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >开始批量</button>
          )}
          {(status === 'started' || status === 'running') && (
            <button
              data-testid="batch-cancel"
              onClick={onCancel}
              style={{
                padding: '6px 16px', fontSize: 13, fontWeight: 500,
                background: 'var(--color-danger)', color: 'var(--color-text-inverse)',
                border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >取消</button>
          )}
        </div>
      </div>
    </div>
  )
}
