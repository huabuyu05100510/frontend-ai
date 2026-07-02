// ImageBatchQueue — 批量翻译队列 UI
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImageBatchQueue } from '../../src/components/ImageBatchQueue'
import type { Task } from '../../src/types'

function makeTask(id: string, name: string): Task {
  return {
    id, name, size: 100, ext: 'png', mime: 'image/png',
    strategy: 'frontend', originalUrl: '/o/' + id, previewUrl: null, previewExt: 'png',
    convertStatus: 'done', status: 'ready',
    createdAt: 0, updatedAt: 0,
  } as Task
}

const TASKS: Task[] = [
  makeTask('a', 'a.png'),
  makeTask('b', 'b.png'),
  makeTask('c', 'c.png'),
]

const defaultProps = {
  open: true,
  tasks: TASKS,
  selectedTaskIds: [] as string[],
  jobId: null as string | null,
  status: 'idle' as const,
  items: [] as Array<{ taskId: string; status: 'pending' | 'ocr-done' | 'image-done' | 'failed'; percent?: number }>,
  onClose: () => {},
  onToggleTask: () => {},
  onStart: () => Promise.resolve('job-1'),
  onCancel: () => Promise.resolve(),
}

describe('ImageBatchQueue', () => {
  it('open=true → 渲染模态 + 任务列表', () => {
    render(<ImageBatchQueue {...defaultProps} />)
    expect(screen.getByTestId('image-batch-queue')).toBeTruthy()
    expect(screen.getByTestId('batch-task-a')).toBeTruthy()
    expect(screen.getByTestId('batch-task-b')).toBeTruthy()
    expect(screen.getByTestId('batch-task-c')).toBeTruthy()
  })

  it('open=false → 不渲染', () => {
    render(<ImageBatchQueue {...defaultProps} open={false} />)
    expect(screen.queryByTestId('image-batch-queue')).toBeNull()
  })

  it('点击任务 → 触发 onToggleTask(taskId)', () => {
    const onToggleTask = vi.fn()
    render(<ImageBatchQueue {...defaultProps} onToggleTask={onToggleTask} />)
    fireEvent.click(screen.getByTestId('batch-task-a'))
    expect(onToggleTask).toHaveBeenCalledWith('a')
  })

  it('selectedTaskIds 中任务显示勾选态', () => {
    render(<ImageBatchQueue {...defaultProps} selectedTaskIds={['a', 'c']} />)
    expect((screen.getByTestId('batch-task-a') as HTMLElement).getAttribute('data-selected')).toBe('true')
    expect((screen.getByTestId('batch-task-b') as HTMLElement).getAttribute('data-selected')).toBe('false')
    expect((screen.getByTestId('batch-task-c') as HTMLElement).getAttribute('data-selected')).toBe('true')
  })

  it('点击「开始」按钮 → 调用 onStart', () => {
    const onStart = vi.fn().mockResolvedValue('job-1')
    render(<ImageBatchQueue {...defaultProps} selectedTaskIds={['a']} onStart={onStart} />)
    fireEvent.click(screen.getByTestId('batch-start'))
    expect(onStart).toHaveBeenCalled()
  })

  it('status=running → 显示「取消」按钮 + 调用 onCancel', () => {
    const onCancel = vi.fn().mockResolvedValue(undefined)
    render(<ImageBatchQueue
      {...defaultProps}
      status="running"
      jobId="job-1"
      onCancel={onCancel}
    />)
    const cancelBtn = screen.getByTestId('batch-cancel')
    expect(cancelBtn).toBeTruthy()
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalled()
  })

  it('status=completed → 显示完成文案', () => {
    render(<ImageBatchQueue
      {...defaultProps}
      status="completed"
      jobId="job-1"
    />)
    expect(screen.getByTestId('batch-status').textContent).toMatch(/完成|completed/i)
  })

  it('status=cancelled → 显示已取消文案', () => {
    render(<ImageBatchQueue
      {...defaultProps}
      status="cancelled"
      jobId="job-1"
    />)
    expect(screen.getByTestId('batch-status').textContent).toMatch(/取消|cancelled/i)
  })

  it('items 数组渲染为状态 pills', () => {
    const items = [
      { taskId: 'a', status: 'ocr-done' as const },
      { taskId: 'b', status: 'image-done' as const, percent: 100 },
      { taskId: 'c', status: 'failed' as const },
    ]
    render(<ImageBatchQueue
      {...defaultProps}
      status="running"
      jobId="job-1"
      items={items}
    />)
    const pills = screen.getByTestId('batch-items')
    expect(pills).toBeTruthy()
    expect(pills.textContent).toContain('a')
    expect(pills.textContent).toContain('b')
    expect(pills.textContent).toContain('c')
  })

  it('点击关闭按钮 → 触发 onClose', () => {
    const onClose = vi.fn()
    render(<ImageBatchQueue {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('batch-close'))
    expect(onClose).toHaveBeenCalled()
  })
})
