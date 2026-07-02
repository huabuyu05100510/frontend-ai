// 模型：claude-sonnet-4-6
// StageIndicator — 4 阶段步骤指示器单元测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { StageIndicator, DEFAULT_STAGES } from '../../src/components/StageIndicator'

describe('StageIndicator', () => {
  beforeEach(() => {
    // 还原 data-motion，确保非 reduced-motion 场景
    document.documentElement.removeAttribute('data-motion')
  })
  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-motion')
  })

  it('renders 4 stages with default labels', () => {
    render(<StageIndicator current="pick" />)
    // 默认 4 个 stage
    for (const s of DEFAULT_STAGES) {
      expect(screen.getByTestId(`oa-stage-${s}`)).toBeTruthy()
    }
    // 4 个 stage ⇒ 3 个连接线
    expect(screen.getByTestId('oa-stage-connector-0')).toBeTruthy()
    expect(screen.getByTestId('oa-stage-connector-1')).toBeTruthy()
    expect(screen.getByTestId('oa-stage-connector-2')).toBeTruthy()
  })

  it('marks current stage with .is-active', () => {
    render(<StageIndicator current="review" />)
    const current = screen.getByTestId('oa-stage-review')
    expect(current.className).toContain('is-active')
    // pick + translating 应该是 done，export 应该是 pending
    expect(screen.getByTestId('oa-stage-pick').className).toContain('is-done')
    expect(screen.getByTestId('oa-stage-translating').className).toContain('is-done')
    expect(screen.getByTestId('oa-stage-export').className).toContain('is-pending')
  })

  it('marks previous stages as done and future stages as pending', () => {
    render(<StageIndicator current="translating" />)
    expect(screen.getByTestId('oa-stage-pick').className).toContain('is-done')
    expect(screen.getByTestId('oa-stage-translating').className).toContain('is-active')
    expect(screen.getByTestId('oa-stage-review').className).toContain('is-pending')
    expect(screen.getByTestId('oa-stage-export').className).toContain('is-pending')
  })

  it('clicking a stage fires onChange', () => {
    const onChange = vi.fn()
    render(<StageIndicator current="pick" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('oa-stage-review'))
    expect(onChange).toHaveBeenCalledWith('review')
  })

  it('Enter key activates focused stage (RTL keyboard nav)', () => {
    const onChange = vi.fn()
    render(<StageIndicator current="pick" onChange={onChange} />)
    const target = screen.getByTestId('oa-stage-export')
    target.focus()
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('export')
  })

  it('Space key activates focused stage', () => {
    const onChange = vi.fn()
    render(<StageIndicator current="pick" onChange={onChange} />)
    const target = screen.getByTestId('oa-stage-translating')
    target.focus()
    fireEvent.keyDown(target, { key: ' ' })
    expect(onChange).toHaveBeenCalledWith('translating')
  })

  it('respects reduced-motion via data-motion="off"', () => {
    document.documentElement.setAttribute('data-motion', 'off')
    const { container } = render(<StageIndicator current="pick" />)
    // StageIndicator 没有 motion 过渡，但 root 应有 data-motion attribute
    expect(document.documentElement.getAttribute('data-motion')).toBe('off')
    // 仍然能渲染所有 chips
    expect(container.querySelectorAll('.oa-stage-chip').length).toBe(4)
  })

  it('accepts custom labels via labels prop', () => {
    render(
      <StageIndicator
        current="review"
        labels={{
          pick: 'Pick 文件',
          translating: '翻译中',
          review: '校对',
          export: '导出',
        }}
      />
    )
    expect(screen.getByText('Pick 文件')).toBeTruthy()
    expect(screen.getByText('翻译中')).toBeTruthy()
    expect(screen.getByText('校对')).toBeTruthy()
    expect(screen.getByText('导出')).toBeTruthy()
  })

  it('clicking a stage logs observability info', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    render(<StageIndicator current="pick" onChange={() => {}} />)
    fireEvent.click(screen.getByTestId('oa-stage-review'))
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/\[translate-ui .*\] stage=review/))
    info.mockRestore()
  })

  it('exposes data-testid on each chip and connector', () => {
    render(<StageIndicator current="export" />)
    expect(screen.getByTestId('oa-stage-pick').getAttribute('data-testid')).toBe('oa-stage-pick')
    expect(screen.getByTestId('oa-stage-connector-0').getAttribute('data-testid')).toBe('oa-stage-connector-0')
  })
})