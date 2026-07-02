// TaskCard 测试（基于回滚后的原版 UI）
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskCard } from '../src/components/TaskCard'
import type { Task } from '../src/types'

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', name: 'resume.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
    convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
    ...over
  } as Task
}

describe('TaskCard（原版 UI + 新数据）', () => {
  it('默认渲染文本徽章 + 文件名 + 状态 chip', () => {
    render(<TaskCard task={task({ name: '郭亚平_前端.pdf' })} onPreview={() => {}} />)
    expect(screen.getByText('郭亚平_前端.pdf')).toBeTruthy()
    expect(screen.getAllByText('PDF').length).toBeGreaterThan(0)  // kind chip 和 icon 都有 PDF
    expect(screen.getByText('可预览')).toBeTruthy()
    expect(document.querySelector('.card-icon')).toBeTruthy()
  })

  it('点击预览按钮触发回调', () => {
    const fn = vi.fn()
    render(<TaskCard task={task()} onPreview={fn} />)
    fireEvent.click(screen.getByText('预览'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('转码未完成（convert_pdf）时预览按钮禁用', () => {
    render(<TaskCard task={task({ strategy: 'convert_pdf', convertStatus: 'processing' })} onPreview={() => {}} />)
    expect(screen.getByText('预览').closest('button')?.disabled).toBe(true)
  })

  it('strategy=frontend 时按钮可用（原文件直读）', () => {
    render(<TaskCard task={task({ strategy: 'frontend', convertStatus: 'processing' })} onPreview={() => {}} />)
    expect(screen.getByText('预览').closest('button')?.disabled).toBe(false)
  })

  it('转码失败显示错误摘要', () => {
    render(<TaskCard task={task({
      convertStatus: 'failed',
      convertError: 'OnlyOfficeUnreachable: docker socket missing'
    })} onPreview={() => {}} />)
    expect(screen.getByText(/转码失败：OnlyOfficeUnreachable/)).toBeTruthy()
  })

  it('任务有 pages / thumbUrl 字段时不报错（不渲染到 UI）', () => {
    expect(() => render(<TaskCard task={task({
      pages: [{ page: 1, url: '/p/1', width: 100, height: 100, bytes: 1000 }],
      thumbUrl: '/api/files/t1?as=thumb'
    })} onPreview={() => {}} />)).not.toThrow()
  })
})