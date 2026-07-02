// DictionaryCard — 浮动查词卡片
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictionaryCard } from '../../src/components/DictionaryCard'

const defaultProps = {
  open: true,
  anchor: { x: 100, y: 200 },
  sourceText: 'Hello world',
  translation: '你好世界',
  confidence: 0.95,
  busy: false,
  onClose: () => {},
  onRetranslate: () => {},
  onCopy: () => {},
  onOpenGlossary: () => {},
  onFontSizeChange: () => {},
  fontSize: 14,
}

describe('DictionaryCard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('open=true 时显示卡片', () => {
    render(<DictionaryCard {...defaultProps} />)
    expect(screen.getByTestId('dictionary-card')).toBeTruthy()
    expect(screen.getByText('Hello world')).toBeTruthy()
    expect(screen.getByText('你好世界')).toBeTruthy()
  })

  it('open=false 时不渲染', () => {
    render(<DictionaryCard {...defaultProps} open={false} />)
    expect(screen.queryByTestId('dictionary-card')).toBeNull()
  })

  it('busy=true 时显示「⏳ 翻译中…」占位', () => {
    render(<DictionaryCard {...defaultProps} busy translation="" />)
    expect(screen.getByText(/翻译中/)).toBeTruthy()
  })

  it('按 Esc → 触发 onClose', () => {
    const onClose = vi.fn()
    render(<DictionaryCard {...defaultProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Cmd+Enter → 触发 onRetranslate', () => {
    const onRetranslate = vi.fn()
    render(<DictionaryCard {...defaultProps} onRetranslate={onRetranslate} />)
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true })
    expect(onRetranslate).toHaveBeenCalled()
  })

  it('Ctrl+Enter → 触发 onRetranslate', () => {
    const onRetranslate = vi.fn()
    render(<DictionaryCard {...defaultProps} onRetranslate={onRetranslate} />)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    expect(onRetranslate).toHaveBeenCalled()
  })

  it('点击「复制」按钮 → 触发 onCopy', () => {
    const onCopy = vi.fn()
    render(<DictionaryCard {...defaultProps} onCopy={onCopy} />)
    fireEvent.click(screen.getByTestId('dictionary-card-copy'))
    expect(onCopy).toHaveBeenCalled()
  })

  it('字号 + 按钮 → 触发 onFontSizeChange(+1)', () => {
    const onFontSizeChange = vi.fn()
    render(<DictionaryCard {...defaultProps} onFontSizeChange={onFontSizeChange} />)
    fireEvent.click(screen.getByTestId('dictionary-card-font-up'))
    expect(onFontSizeChange).toHaveBeenCalledWith(1)
  })

  it('字号 - 按钮 → 触发 onFontSizeChange(-1)', () => {
    const onFontSizeChange = vi.fn()
    render(<DictionaryCard {...defaultProps} onFontSizeChange={onFontSizeChange} />)
    fireEvent.click(screen.getByTestId('dictionary-card-font-down'))
    expect(onFontSizeChange).toHaveBeenCalledWith(-1)
  })

  it('点击背景遮罩 → 触发 onClose', () => {
    const onClose = vi.fn()
    render(<DictionaryCard {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('dictionary-card-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('点击「术语库」按钮 → 触发 onOpenGlossary', () => {
    const onOpenGlossary = vi.fn()
    render(<DictionaryCard {...defaultProps} onOpenGlossary={onOpenGlossary} />)
    fireEvent.click(screen.getByTestId('dictionary-card-glossary'))
    expect(onOpenGlossary).toHaveBeenCalled()
  })

  it('显示置信度', () => {
    render(<DictionaryCard {...defaultProps} confidence={0.85} />)
    expect(screen.getByTestId('dictionary-card-confidence').textContent).toContain('85%')
  })

  it('fontSize 反映到 sourceText 样式', () => {
    render(<DictionaryCard {...defaultProps} fontSize={20} />)
    const srcEl = screen.getByTestId('dictionary-card-source')
    expect((srcEl as HTMLElement).style.fontSize).toBe('20px')
  })
})
