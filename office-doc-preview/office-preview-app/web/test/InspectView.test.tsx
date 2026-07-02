// InspectView 组件测试（TDD）— 智检模式完整渲染
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InspectView } from '../src/inspect/InspectView'
import type { InspectDiffResponse } from '../src/types'

const MOCK_DIFF: InspectDiffResponse = {
  ops: [
    { op: 'equal', text: '权' },
    { op: 'delete', text: '利' },
    { op: 'insert', text: '力' },
    { op: 'equal', text: ' 往开来' },
  ],
  errors: [
    { id: 'e1', original: '利', corrected: '力', op: 'change' },
  ],
  hunks: [
    { kind: 'equal', text: '权' },
    { kind: 'change', original: '利', corrected: '力' },
    { kind: 'equal', text: ' 往开来' },
  ],
  tokens: [
    { type: 'equal', text: '权' },
    { type: 'delete', text: '利' },
    { type: 'insert', text: '力' },
    { type: 'equal', text: ' 往开来' },
  ],
  ms: 3,
  meta: { granularity: 'char', leftChars: 5, rightChars: 5, errorCount: 1 },
}

describe('InspectView — 基础渲染', () => {
  it('渲染分类导航（含 CATEGORIES 所有项）', () => {
    render(<InspectView diff={null} loading={false} loadError={null} onRetry={() => {}} />)
    // 至少有"文字校对"
    expect(screen.getByText('文字校对')).toBeTruthy()
  })

  it('渲染主文档区 data-testid="inspect-left"', () => {
    render(<InspectView diff={null} loading={false} loadError={null} onRetry={() => {}} />)
    expect(screen.getByTestId('inspect-left')).toBeTruthy()
  })

  it('渲染错误侧栏 data-testid="inspect-diff-sidebar"', () => {
    render(<InspectView diff={null} loading={false} loadError={null} onRetry={() => {}} />)
    expect(screen.getByTestId('inspect-diff-sidebar')).toBeTruthy()
  })

  it('loading=true 显示解析中', () => {
    const { container } = render(<InspectView diff={null} loading={true} loadError={null} onRetry={() => {}} />)
    expect(container.textContent).toContain('解析中')
  })

  it('loadError 有值时显示错误信息 + 重试按钮', () => {
    const onRetry = vi.fn()
    const { container } = render(<InspectView diff={null} loading={false} loadError="网络错误" onRetry={onRetry} />)
    expect(container.textContent).toContain('加载失败：网络错误')
    const retryBtns = screen.getAllByRole('button', { name: /重试/ })
    expect(retryBtns.length).toBeGreaterThan(0)
    fireEvent.click(retryBtns[0])
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('InspectView — 文档内容 + 错误高亮', () => {
  it('diff 数据就绪后渲染 ErrorToken（delete token 红色下划线）', async () => {
    render(<InspectView diff={MOCK_DIFF} loading={false} loadError={null} onRetry={() => {}} />)
    await waitFor(() => {
      const main = screen.getByTestId('inspect-left')
      expect(main.querySelector('.diff-token-delete')?.textContent).toBe('利')
    })
  })

  it('侧栏渲染所有错误条目（编号 + 原文 → 改正）', async () => {
    render(<InspectView diff={MOCK_DIFF} loading={false} loadError={null} onRetry={() => {}} />)
    await waitFor(() => {
      const sidebar = screen.getByTestId('inspect-diff-sidebar')
      expect(sidebar.textContent).toContain('利')
      expect(sidebar.textContent).toContain('力')
    })
  })
})

describe('InspectView — 错误交互', () => {
  it('每条错误有接受和忽略按钮', async () => {
    render(<InspectView diff={MOCK_DIFF} loading={false} loadError={null} onRetry={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /接受/ }).length).toBe(1)
      expect(screen.getAllByRole('button', { name: /忽略/ }).length).toBe(1)
    })
  })

  it('点击接受 → is-accepted class', async () => {
    render(<InspectView diff={MOCK_DIFF} loading={false} loadError={null} onRetry={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /接受/ }).length).toBeGreaterThan(0)
    })
    const acceptBtn = screen.getAllByRole('button', { name: /接受/ })[0]
    fireEvent.click(acceptBtn)
    const item = acceptBtn.closest('[data-error-id]')
    expect(item?.className).toMatch(/is-accepted/)
  })

  it('点击忽略 → is-ignored class', async () => {
    render(<InspectView diff={MOCK_DIFF} loading={false} loadError={null} onRetry={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /忽略/ }).length).toBeGreaterThan(0)
    })
    const ignoreBtn = screen.getAllByRole('button', { name: /忽略/ })[0]
    fireEvent.click(ignoreBtn)
    const item = ignoreBtn.closest('[data-error-id]')
    expect(item?.className).toMatch(/is-ignored/)
  })

  it('点击错误条目展开详情', async () => {
    render(<InspectView diff={MOCK_DIFF} loading={false} loadError={null} onRetry={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /忽略/ }).length).toBeGreaterThan(0)
    })
    const firstItem = screen.getByTestId('inspect-diff-sidebar').querySelector('[data-error-id]') as HTMLElement
    fireEvent.click(firstItem)
    expect(firstItem.className).toMatch(/is-selected/)
  })
})
