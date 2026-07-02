// FilePicker + fileGlyph 组件测试（TDD）
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilePicker, fileGlyph } from '../src/inspect/FilePicker'
import { useStore } from '../src/store'

function txtTask(over: { id?: string; name?: string; ext?: string } = {}) {
  return {
    id: over.id || 't1', name: over.name || 'test.txt', size: 100,
    ext: over.ext || 'txt', mime: 'text/plain', strategy: 'frontend' as const,
    originalUrl: '/o', previewUrl: '/p', previewExt: 'txt',
    convertStatus: 'done' as const, status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
  }
}

describe('fileGlyph', () => {
  it('txt → 📄', () => expect(fileGlyph('txt')).toBe('📄'))
  it('md → 📄', () => expect(fileGlyph('md')).toBe('📄'))
  it('pdf → 📕', () => expect(fileGlyph('pdf')).toBe('📕'))
  it('docx → 📘', () => expect(fileGlyph('docx')).toBe('📘'))
  it('doc → 📘', () => expect(fileGlyph('doc')).toBe('📘'))
  it('pptx → 📗', () => expect(fileGlyph('pptx')).toBe('📗'))
  it('xlsx → 📊', () => expect(fileGlyph('xlsx')).toBe('📊'))
  it('unknown → 📄 (default)', () => expect(fileGlyph('xyz')).toBe('📄'))
  it('空字符串 → 📄 (default)', () => expect(fileGlyph('')).toBe('📄'))
})

describe('FilePicker', () => {
  beforeEach(() => {
    useStore.setState({
      tasks: [
        txtTask({ id: 'src', name: '原文.txt' }),
        txtTask({ id: 'other', name: '改正.txt' }),
        txtTask({ id: 'another', name: '另一份.pdf', ext: 'pdf' }),
      ],
    })
  })

  it('渲染选择器标题 + 源文件名', () => {
    const { container } = render(<FilePicker sourceId="src" sourceName="原文.txt" />)
    expect(screen.getByTestId('inspect-compare-picker')).toBeTruthy()
    expect(container.textContent).toContain('原文.txt')
  })

  it('排除源文件，列出其他任务', () => {
    const { container } = render(<FilePicker sourceId="src" sourceName="原文.txt" />)
    expect(container.querySelector('[data-testid="inspect-compare-pick-other"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="inspect-compare-pick-another"]')).toBeTruthy()
    // 源文件不在列表中
    expect(container.querySelector('[data-testid="inspect-compare-pick-src"]')).toBeNull()
  })

  it('点击候选任务触发 setInspectCompare', () => {
    render(<FilePicker sourceId="src" sourceName="原文.txt" />)
    fireEvent.click(screen.getByTestId('inspect-compare-pick-other'))
    expect(useStore.getState().inspectCompare?.id).toBe('other')
  })

  it('无其他任务时显示空提示', () => {
    useStore.setState({ tasks: [txtTask({ id: 'solo' })] })
    const { container } = render(<FilePicker sourceId="solo" sourceName="only.txt" />)
    expect(container.querySelector('.icm-picker-empty')?.textContent).toContain('没有其他可对比的文件')
  })
})
