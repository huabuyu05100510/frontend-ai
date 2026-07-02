// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocTranslateProgress } from '../../src/components/DocTranslateProgress'

describe('DocTranslateProgress', () => {
  it('renders idle state with no progress', () => {
    render(
      <DocTranslateProgress
        jobId="job_a"
        status="idle"
        percent={0}
        eta="—"
        completed={0}
        total={0}
        glossaryHits={0}
        tmHits={0}
        error={null}
        onCancel={vi.fn()}
        onExportPartial={vi.fn()}
      />,
    )
    expect(screen.getByTestId('doc-translate-progress')).toBeTruthy()
  })

  it('renders running state with progress and chips', () => {
    render(
      <DocTranslateProgress
        jobId="job_b"
        status="running"
        percent={40}
        eta="约 12s"
        completed={2}
        total={5}
        glossaryHits={3}
        tmHits={1}
        error={null}
        onCancel={vi.fn()}
        onExportPartial={vi.fn()}
      />,
    )
    expect(screen.getByTestId('doc-translate-progress-percent').textContent).toContain('40')
    expect(screen.getByTestId('doc-translate-progress-eta').textContent).toContain('12s')
    expect(screen.getByTestId('doc-translate-progress-completed').textContent).toContain('2/5')
    expect(screen.getByTestId('doc-translate-glossary-hits').textContent).toContain('3')
    expect(screen.getByTestId('doc-translate-tm-hits').textContent).toContain('1')
  })

  it('shows error banner when error provided', () => {
    render(
      <DocTranslateProgress
        jobId="job_e"
        status="failed"
        percent={20}
        eta="—"
        completed={1}
        total={5}
        glossaryHits={0}
        tmHits={0}
        error="网络异常"
        onCancel={vi.fn()}
        onExportPartial={vi.fn()}
      />,
    )
    expect(screen.getByTestId('doc-translate-error').textContent).toContain('网络异常')
  })

  it('triggers onCancel when cancel button clicked', () => {
    const onCancel = vi.fn()
    render(
      <DocTranslateProgress
        jobId="job_c"
        status="running"
        percent={20}
        eta="—"
        completed={1}
        total={5}
        glossaryHits={0}
        tmHits={0}
        error={null}
        onCancel={onCancel}
        onExportPartial={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('doc-translate-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('triggers onExportPartial when partial export button clicked (running only)', () => {
    const onExport = vi.fn()
    render(
      <DocTranslateProgress
        jobId="job_p"
        status="running"
        percent={20}
        eta="—"
        completed={1}
        total={5}
        glossaryHits={0}
        tmHits={0}
        error={null}
        onCancel={vi.fn()}
        onExportPartial={onExport}
      />,
    )
    fireEvent.click(screen.getByTestId('doc-translate-export-partial'))
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('hides partial export button when status is finished', () => {
    render(
      <DocTranslateProgress
        jobId="job_f"
        status="finished"
        percent={100}
        eta="完成"
        completed={5}
        total={5}
        glossaryHits={0}
        tmHits={0}
        error={null}
        onCancel={vi.fn()}
        onExportPartial={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('doc-translate-export-partial')).toBeNull()
  })

  it('hides cancel button when status is finished', () => {
    render(
      <DocTranslateProgress
        jobId="job_g"
        status="finished"
        percent={100}
        eta="完成"
        completed={5}
        total={5}
        glossaryHits={0}
        tmHits={0}
        error={null}
        onCancel={vi.fn()}
        onExportPartial={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('doc-translate-cancel')).toBeNull()
  })

  it('renders finished state with success message', () => {
    render(
      <DocTranslateProgress
        jobId="job_ok"
        status="finished"
        percent={100}
        eta="完成"
        completed={5}
        total={5}
        glossaryHits={0}
        tmHits={0}
        error={null}
        onCancel={vi.fn()}
        onExportPartial={vi.fn()}
      />,
    )
    expect(screen.getByTestId('doc-translate-status-text').textContent).toContain('完成')
  })
})
