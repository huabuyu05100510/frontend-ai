// ErrorToken 组件测试（TDD）
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorToken } from '../src/inspect/ErrorToken'

describe('ErrorToken', () => {
  it('delete token 渲染为红色下划线 span', () => {
    const { container } = render(
      <ErrorToken token={{ type: 'delete', text: '错字', errorId: 'e1' }} isSelected={false} />
    )
    const el = container.querySelector('.diff-token-delete')
    expect(el).toBeTruthy()
    expect(el?.textContent).toBe('错字')
  })

  it('equal token 渲染为普通 span', () => {
    const { container } = render(
      <ErrorToken token={{ type: 'equal', text: '正常', errorId: null }} isSelected={false} />
    )
    const el = container.querySelector('.diff-token-equal')
    expect(el).toBeTruthy()
    expect(el?.textContent).toBe('正常')
  })

  it('delete token 设置 data-error-id 属性', () => {
    const { container } = render(
      <ErrorToken token={{ type: 'delete', text: 'x', errorId: 'e99' }} isSelected={false} />
    )
    expect(container.querySelector('[data-error-id="e99"]')).toBeTruthy()
  })

  it('equal token 不设置 data-error-id', () => {
    const { container } = render(
      <ErrorToken token={{ type: 'equal', text: 'y', errorId: null }} isSelected={false} />
    )
    expect(container.querySelector('[data-error-id]')).toBeNull()
  })

  it('选中状态添加 is-selected class', () => {
    const { container } = render(
      <ErrorToken token={{ type: 'delete', text: 'z', errorId: 'e1' }} isSelected={true} />
    )
    expect(container.querySelector('.diff-token-delete.is-selected')).toBeTruthy()
  })

  it('未选中状态无 is-selected class', () => {
    const { container } = render(
      <ErrorToken token={{ type: 'delete', text: 'z', errorId: 'e1' }} isSelected={false} />
    )
    expect(container.querySelector('.is-selected')).toBeNull()
  })

  it('delete token 有 onClick 时可点击（role=button）', () => {
    const onClick = vi.fn()
    const { container } = render(
      <ErrorToken token={{ type: 'delete', text: 'a', errorId: 'e1' }} isSelected={false} onClick={onClick} />
    )
    const el = container.querySelector('[role="button"]')
    expect(el).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el && fireEvent.click(el)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
