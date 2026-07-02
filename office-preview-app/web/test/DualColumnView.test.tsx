// DualColumnView 字符联动高亮测试（TDD）
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DualColumnView } from '../src/inspect/DualColumnView'
import type { InspectDiffResponse } from '../src/types'

const MULTI_CHAR_DIFF: InspectDiffResponse = {
  ops: [],
  errors: [
    { id: 'e1', original: '既', corrected: '继', op: 'change' },
    { id: 'e2', original: '岳', corrected: '岳阳', op: 'change' },
  ],
  hunks: [],
  tokens: [],
  paragraphBlocks: [
    {
      kind: 'change',
      leftText: '前文 既往开来 后文 岳楼 结尾',
      rightText: '前文 继往开来 后文 岳阳楼 结尾',
      charOps: [
        { op: 'equal', text: '前文 ' },
        { op: 'delete', text: '既' },
        { op: 'insert', text: '继' },
        { op: 'equal', text: '往开来 后文 ' },
        { op: 'delete', text: '岳' },
        { op: 'insert', text: '岳阳' },
        { op: 'equal', text: '楼 结尾' },
      ],
    },
  ],
  ms: 2,
  meta: { granularity: 'paragraph', leftChars: 20, rightChars: 21, errorCount: 2 },
}

describe('DualColumnView — 字符联动高亮', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => cleanup())

  it('change block 左侧 delete span 有 data-pair-idx 属性', async () => {
    render(<DualColumnView diff={MULTI_CHAR_DIFF} loading={false} loadError={null} />)
    await waitFor(() => {
      const delSpans = document.querySelectorAll('.dcv-para-side-left .dcv-char-delete')
      expect(delSpans.length).toBe(2) // 既、岳
      // 第一个 delete (既) 的 pairIdx 应为 0
      expect(delSpans[0].getAttribute('data-pair-idx')).toBe('0')
      // 第二个 delete (岳) 的 pairIdx 应为 1
      expect(delSpans[1].getAttribute('data-pair-idx')).toBe('1')
    })
  })

  it('change block 右侧 insert span 有 data-pair-idx 属性', async () => {
    render(<DualColumnView diff={MULTI_CHAR_DIFF} loading={false} loadError={null} />)
    await waitFor(() => {
      const insSpans = document.querySelectorAll('.dcv-para-side-right .dcv-char-insert')
      expect(insSpans.length).toBe(2) // 继、岳阳
      expect(insSpans[0].getAttribute('data-pair-idx')).toBe('0') // 继 ←→ 既
      expect(insSpans[1].getAttribute('data-pair-idx')).toBe('1')   // 岳阳 ←← 岳
    })
  })

  it('左右 diff 字符按顺序配对：左第 N 个 delete ↔ 右第 N 个 insert 同 pairIdx', async () => {
    render(<DualColumnView diff={MULTI_CHAR_DIFF} loading={false} loadError={null} />)
    await waitFor(() => {
      const leftDeletes = document.querySelectorAll('.dcv-para-side-left .dcv-char-delete')
      const rightInserts = document.querySelectorAll('.dcv-para-side-right .dcv-char-insert')
      // 左"既"(pairIdx=0) 对应 右"继"(pairIdx=0)
      expect(leftDeletes[0].getAttribute('data-pair-idx')).toEqual(rightInserts[0].getAttribute('data-pair-idx'))
      // 左"岳"(pairIdx=1) 对应 右"岳阳"(pairIdx=1)
      expect(leftDeletes[1].getAttribute('data-pair-idx')).toEqual(rightInserts[1].getAttribute('data-pair-idx'))
    })
  })

  it('hover 左侧 delete 字符 → 右侧对应 insert 获得 hovered 样式', async () => {
    render(<DualColumnView diff={MULTI_CHAR_DIFF} loading={false} loadError={null} />)
    await waitFor(() => {
      const leftDeletes = document.querySelectorAll('.dcv-para-side-left .dcv-char-delete')
      expect(leftDeletes.length).toBeGreaterThan(0)
    })

    const firstDel = document.querySelector('.dcv-para-side-left .dcv-char-delete') as HTMLElement
    fireEvent.mouseEnter(firstDel)

    await waitFor(() => {
      const rightInserts = document.querySelectorAll('.dcv-para-side-right .dcv-char-insert')
      // 右侧第一个 insert 应该有联动高亮 class
      expect(rightInserts[0].className).toContain('dcv-char-hovered')
      // 右侧第二个 insert 不应有（不是配对）
      expect(rightInserts[1].className).not.toContain('dcv-char-hovered')
    })
  })

  it('hover 右侧 insert 字符 → 左侧对应 delete 获得 hovered 样式', async () => {
    render(<DualColumnView diff={MULTI_CHAR_DIFF} loading={false} loadError={null} />)
    await waitFor(() => {
      expect(document.querySelector('.dcv-para-side-right .dcv-char-insert')).toBeTruthy()
    })

    const secondIns = document.querySelectorAll('.dcv-para-side-right .dcv-char-insert')[1] as HTMLElement
    fireEvent.mouseEnter(secondIns)

    await waitFor(() => {
      const leftDeletes = document.querySelectorAll('.dcv-para-side-left .dcv-char-delete')
      // 左侧第二个 delete 应该有联动高亮
      expect(leftDeletes[1].className).toContain('dcv-char-hovered')
      // 左侧第一个不应有
      expect(leftDeletes[0].className).not.toContain('dcv-char-hovered')
    })
  })

  it('mouseLeave 后联动高亮消失', async () => {
    render(<DualColumnView diff={MULTI_CHAR_DIFF} loading={false} loadError={null} />)
    await waitFor(() => {
      expect(document.querySelector('.dcv-char-delete')).toBeTruthy()
    })

    const firstDel = document.querySelector('.dcv-para-side-left .dcv-char-delete') as HTMLElement
    fireEvent.mouseEnter(firstDel)
    await waitFor(() => {
      expect(document.querySelector('.dcv-char-hovered')).toBeTruthy()
    })
    fireEvent.mouseLeave(firstDel)
    await waitFor(() => {
      expect(document.querySelector('.dcv-char-hovered')).toBeNull()
    })
  })
})
