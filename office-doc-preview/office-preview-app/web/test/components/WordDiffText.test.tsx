// 模型：claude-sonnet-4-6
// WordDiffText 渲染测试
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WordDiffText } from '../../src/components/WordDiffText'
import type { WordDiffOp } from '../../src/hooks/useWordDiff'

describe('<WordDiffText />', () => {
  it('空 ops → 显示 emptyHint', () => {
    render(<WordDiffText srcText="a" tgtText="b" ops={[]} />)
    expect(screen.getByText('无差异')).toBeInTheDocument()
  })

  it('inline 模式：equal/delete/insert 都正确分类', () => {
    const ops: WordDiffOp[] = [
      { op: 'equal', text: 'Hi ' },
      { op: 'delete', text: 'world' },
      { op: 'insert', text: 'there' },
      { op: 'equal', text: ' ok' },
    ]
    const { container } = render(
      <WordDiffText srcText="Hi world ok" tgtText="Hi there ok" ops={ops} layout="inline" />,
    )
    const root = container.querySelector('[data-layout="inline"]')!
    // 使用 textContent 精确匹配（含尾随空格）
    const spans = Array.from(root.querySelectorAll('span'))
    const byText = (txt: string) => spans.find((s) => s.textContent === txt)
    expect(byText('Hi ')?.className).toContain('oa-word-diff-equal')
    expect(byText('world')?.className).toContain('oa-word-diff-delete')
    expect(byText('there')?.className).toContain('oa-word-diff-insert')
    expect(byText(' ok')?.className).toContain('oa-word-diff-equal')
  })

  it('paragraph 模式：原/译双行 + data-twin-idx 联动', () => {
    const ops: WordDiffOp[] = [
      { op: 'equal', text: 'a ' },
      { op: 'delete', text: 'bc' },
      { op: 'insert', text: 'xy' },
      { op: 'equal', text: ' d' },
    ]
    const { container } = render(
      <WordDiffText srcText="a bc d" tgtText="a xy d" ops={ops} layout="paragraph" />,
    )
    const root = container.querySelector('[data-layout="paragraph"]') as HTMLElement
    const srcRow = root.querySelector('.oa-word-diff-row--src') as HTMLElement
    const tgtRow = root.querySelector('.oa-word-diff-row--tgt') as HTMLElement
    // delete 与 insert 共享 twin-idx
    const delSpan = srcRow.querySelector('.oa-word-diff-delete') as HTMLElement
    const insSpan = tgtRow.querySelector('.oa-word-diff-insert') as HTMLElement
    expect(delSpan.getAttribute('data-twin-idx')).toBe(insSpan.getAttribute('data-twin-idx'))
  })

  it('source 模式：仅显示 equal + delete（不含 insert）', () => {
    const ops: WordDiffOp[] = [
      { op: 'equal', text: 'a ' },
      { op: 'delete', text: 'b' },
      { op: 'insert', text: 'c' },
    ]
    const { container } = render(
      <WordDiffText srcText="a b" tgtText="a c" ops={ops} layout="source" />,
    )
    const root = container.querySelector('[data-layout="source"]') as HTMLElement
    expect(within(root).queryByText('c')).toBeNull()  // insert 不出现
    expect(within(root).getByText('b').className).toContain('oa-word-diff-delete')
  })

  it('target 模式：仅显示 equal + insert（不含 delete）', () => {
    const ops: WordDiffOp[] = [
      { op: 'equal', text: 'a ' },
      { op: 'delete', text: 'b' },
      { op: 'insert', text: 'c' },
    ]
    const { container } = render(
      <WordDiffText srcText="a b" tgtText="a c" ops={ops} layout="target" />,
    )
    const root = container.querySelector('[data-layout="target"]') as HTMLElement
    expect(within(root).queryByText('b')).toBeNull()
    expect(within(root).getByText('c').className).toContain('oa-word-diff-insert')
  })

  it('主题字段传入后渲染到 data-theme', () => {
    const ops: WordDiffOp[] = [{ op: 'equal', text: 'a' }]
    const { container } = render(
      <WordDiffText srcText="a" tgtText="a" ops={ops} theme="dark" />,
    )
    expect(container.querySelector('[data-theme="dark"]')).toBeTruthy()
  })

  it('testIdPrefix 应用于 root', () => {
    const { container } = render(
      <WordDiffText srcText="a" tgtText="a" ops={[{ op: 'equal', text: 'a' }]} testIdPrefix="my-diff" />,
    )
    expect(container.querySelector('[data-testid="my-diff"]')).toBeTruthy()
  })

  it('性能：>batchThreshold token 仍能渲染（合并为 batched 容器）', () => {
    const ops: WordDiffOp[] = []
    for (let i = 0; i < 1500; i++) ops.push({ op: 'equal', text: 'a' })
    const t0 = performance.now()
    const { container } = render(
      <WordDiffText srcText="a..." tgtText="a..." ops={ops} batchThreshold={1000} layout="inline" />,
    )
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(500)
    expect(container.querySelector('.oa-word-diff-batched')).toBeTruthy()
  })
})
