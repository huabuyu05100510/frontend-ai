// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocTranslateTaskPanel } from '../../src/components/DocTranslateTaskPanel'
import type { Task } from '../../src/types'

function mkTask(id: string, ext: string, name: string): Task {
  return {
    id, name, size: 1024, ext, mime: 'application/octet-stream',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: ext,
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
  } as Task
}

describe('DocTranslateTaskPanel', () => {
  it('renders empty state when no tasks', () => {
    render(
      <DocTranslateTaskPanel
        tasks={[]}
        selectedTask={null}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx']}
        onToggleFormat={vi.fn()}
        onStartTranslate={vi.fn()}
        busy={false}
      />,
    )
    expect(screen.getByTestId('doc-translate-empty')).toBeTruthy()
  })

  it('renders file cards and triggers onSelectTask', () => {
    const onSelect = vi.fn()
    const tasks = [mkTask('t1', 'docx', 'doc1.docx'), mkTask('t2', 'pdf', 'doc2.pdf')]
    render(
      <DocTranslateTaskPanel
        tasks={tasks}
        selectedTask={null}
        onSelectTask={onSelect}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx']}
        onToggleFormat={vi.fn()}
        onStartTranslate={vi.fn()}
        busy={false}
      />,
    )
    expect(screen.getByTestId('doc-translate-card-t1')).toBeTruthy()
    expect(screen.getByTestId('doc-translate-card-t2')).toBeTruthy()
    fireEvent.click(screen.getByTestId('doc-translate-card-t1'))
    expect(onSelect).toHaveBeenCalledWith(tasks[0])
  })

  it('marks selected task with .selected class', () => {
    const task = mkTask('t1', 'docx', 'doc1.docx')
    const { container } = render(
      <DocTranslateTaskPanel
        tasks={[task]}
        selectedTask={task}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx']}
        onToggleFormat={vi.fn()}
        onStartTranslate={vi.fn()}
        busy={false}
      />,
    )
    const card = container.querySelector('[data-testid="doc-translate-card-t1"]') as HTMLElement
    expect(card.className).toContain('selected')
  })

  it('toggles format checkboxes via onToggleFormat', () => {
    const onToggle = vi.fn()
    render(
      <DocTranslateTaskPanel
        tasks={[]}
        selectedTask={null}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx']}
        onToggleFormat={onToggle}
        onStartTranslate={vi.fn()}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByTestId('doc-translate-fmt-bilingual-pdf'))
    expect(onToggle).toHaveBeenCalledWith('bilingual-pdf')
  })

  it('changes source/target languages', () => {
    const onSrc = vi.fn()
    const onTgt = vi.fn()
    const { container } = render(
      <DocTranslateTaskPanel
        tasks={[]}
        selectedTask={null}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={onSrc}
        onChangeTargetLang={onTgt}
        formats={['bilingual-docx']}
        onToggleFormat={vi.fn()}
        onStartTranslate={vi.fn()}
        busy={false}
      />,
    )
    const selects = container.querySelectorAll('select')
    fireEvent.change(selects[0], { target: { value: 'ja' } })
    fireEvent.change(selects[1], { target: { value: 'ko' } })
    expect(onSrc).toHaveBeenCalledWith('ja')
    expect(onTgt).toHaveBeenCalledWith('ko')
  })

  it('disables start button when no task selected or busy', () => {
    const onStart = vi.fn()
    const { rerender } = render(
      <DocTranslateTaskPanel
        tasks={[]}
        selectedTask={null}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx']}
        onToggleFormat={vi.fn()}
        onStartTranslate={onStart}
        busy={false}
      />,
    )
    const startBtn = screen.getByTestId('doc-translate-start')
    expect((startBtn as HTMLButtonElement).disabled).toBe(true)
    // busy=true when task selected
    const task = mkTask('t1', 'docx', 'a.docx')
    rerender(
      <DocTranslateTaskPanel
        tasks={[task]}
        selectedTask={task}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx']}
        onToggleFormat={vi.fn()}
        onStartTranslate={onStart}
        busy={true}
      />,
    )
    expect((screen.getByTestId('doc-translate-start') as HTMLButtonElement).disabled).toBe(true)
  })

  it('triggers onStartTranslate when start clicked with selected task', () => {
    const onStart = vi.fn()
    const task = mkTask('t1', 'docx', 'a.docx')
    render(
      <DocTranslateTaskPanel
        tasks={[task]}
        selectedTask={task}
        onSelectTask={vi.fn()}
        sourceLang="zh-CN"
        targetLang="en"
        onChangeSourceLang={vi.fn()}
        onChangeTargetLang={vi.fn()}
        formats={['bilingual-docx', 'bilingual-pdf']}
        onToggleFormat={vi.fn()}
        onStartTranslate={onStart}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByTestId('doc-translate-start'))
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
