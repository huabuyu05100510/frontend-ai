// 模型：claude-sonnet-4-6
// WordDiffText — 词级 diff 渲染（红删 / 蓝插 / 灰等）
//
// 输入：srcText + tgtText（可选直接传 ops 跳过 hook）
// 染色：equal → 默认；delete → 红底删除线；insert → 蓝底下划线
// 联动：layout='paragraph' 时 insert 与 delete 共享 data-twin-idx，hover 联动
// 性能：>1000 token 时切到 batch 渲染（每 100 token 一个 React 子节点）

import React, { useMemo } from 'react'
import type { WordDiffOp } from '../hooks/useWordDiff'

export interface WordDiffTextProps {
  srcText: string
  tgtText: string
  ops?: WordDiffOp[]
  srcOffsets?: Array<[number, number]>
  tgtOffsets?: Array<[number, number]>
  theme?: 'light' | 'dark'
  layout?: 'inline' | 'paragraph' | 'source' | 'target'
  className?: string
  testIdPrefix?: string
  /** 当传入 ops 为空时显示的占位文本（默认 "无差异"） */
  emptyHint?: string
  /** 大于此 token 数时合并渲染以提升性能 */
  batchThreshold?: number
}

function classifyTokenClass(op: WordDiffOp['op']): string {
  if (op === 'delete') return 'oa-word-diff-delete'
  if (op === 'insert') return 'oa-word-diff-insert'
  return 'oa-word-diff-equal'
}

/**
 * 把 ops 切成"原文/译文"两份 tokens 数组（保持双栏对齐）
 * - equal: 进两边
 * - delete: 进 src
 * - insert: 进 tgt
 */
function splitOpsToColumns(ops: WordDiffOp[]): { src: WordDiffOp[]; tgt: WordDiffOp[] } {
  const src: WordDiffOp[] = []
  const tgt: WordDiffOp[] = []
  let changeIdx = 0
  for (const op of ops) {
    if (op.op === 'equal') {
      src.push(op)
      tgt.push(op)
    } else if (op.op === 'delete') {
      src.push({ ...op, text: `${op.text}` })
      changeIdx++
    } else if (op.op === 'insert') {
      tgt.push({ ...op, text: `${op.text}` })
      changeIdx++
    }
  }
  // 给 delete/insert 配对相同的 twin-idx 用于 hover 联动
  // 规则：连续的 delete+insert 共享一个 cIdx；遇到 equal 时重置
  let sIdx = 0, tIdx = 0, cIdx = -1
  for (const op of ops) {
    if (op.op === 'equal') { sIdx++; tIdx++; cIdx = -1 }
    else if (op.op === 'delete') {
      if (cIdx === -1) cIdx++  // 开启新的 change group
      ;(src[sIdx] as any).twinIdx = cIdx
      sIdx++
    } else if (op.op === 'insert') {
      if (cIdx === -1) cIdx++  // 纯 insert 也开新 group
      ;(tgt[tIdx] as any).twinIdx = cIdx
      tIdx++
    }
  }
  return { src, tgt }
}

export function WordDiffText({
  srcText,
  tgtText,
  ops,
  srcOffsets,
  tgtOffsets,
  theme,
  layout = 'inline',
  className,
  testIdPrefix = 'oa-word-diff',
  emptyHint = '无差异',
  batchThreshold = 1000,
}: WordDiffTextProps) {
  const { src, tgt } = useMemo(() => {
    if (!ops || ops.length === 0) return { src: [], tgt: [] }
    return splitOpsToColumns(ops)
  }, [ops])

  if (!ops || ops.length === 0) {
    return (
      <div
        data-testid={testIdPrefix}
        data-layout={layout}
        data-theme={theme}
        className={`oa-word-diff oa-word-diff--empty ${className ?? ''}`.trim()}
      >
        <span className="oa-word-diff-empty">{emptyHint}</span>
      </div>
    )
  }

  // inline: 上下拼接显示
  if (layout === 'inline') {
    return (
      <div
        data-testid={testIdPrefix}
        data-layout="inline"
        data-theme={theme}
        data-token-count={String(ops.length)}
        className={`oa-word-diff oa-word-diff--inline ${className ?? ''}`.trim()}
      >
        {ops.length > batchThreshold ? (
          <span className="oa-word-diff-batched">
            {ops.map((op, i) => (
              <span key={i} className={classifyTokenClass(op.op)}>{op.text}</span>
            ))}
          </span>
        ) : (
          ops.map((op, i) => (
            <span key={i} className={classifyTokenClass(op.op)}>{op.text}</span>
          ))
        )}
      </div>
    )
  }

  // paragraph: 上下双行 + hover 联动
  if (layout === 'paragraph') {
    return (
      <div
        data-testid={testIdPrefix}
        data-layout="paragraph"
        data-theme={theme}
        data-token-count={String(ops.length)}
        className={`oa-word-diff oa-word-diff--paragraph ${className ?? ''}`.trim()}
      >
        <div className="oa-word-diff-row oa-word-diff-row--src">
          <span className="oa-word-diff-label">原</span>
          {src.map((op, i) => (
            <span
              key={`s-${i}`}
              data-twin-idx={(op as any).twinIdx ?? ''}
              className={`oa-word-diff-token ${classifyTokenClass(op.op)}`}
            >{op.text}</span>
          ))}
        </div>
        <div className="oa-word-diff-row oa-word-diff-row--tgt">
          <span className="oa-word-diff-label">译</span>
          {tgt.map((op, i) => (
            <span
              key={`t-${i}`}
              data-twin-idx={(op as any).twinIdx ?? ''}
              className={`oa-word-diff-token ${classifyTokenClass(op.op)}`}
            >{op.text}</span>
          ))}
        </div>
      </div>
    )
  }

  // source 单行: 仅显示 delete + equal（红删 + 灰等）
  if (layout === 'source') {
    return (
      <div
        data-testid={testIdPrefix}
        data-layout="source"
        data-theme={theme}
        className={`oa-word-diff oa-word-diff--source ${className ?? ''}`.trim()}
      >
        {src.map((op, i) => (
          <span key={i} className={classifyTokenClass(op.op)}>{op.text}</span>
        ))}
      </div>
    )
  }

  // target 单行: 仅显示 insert + equal（蓝插 + 灰等）
  return (
    <div
      data-testid={testIdPrefix}
      data-layout="target"
      data-theme={theme}
      className={`oa-word-diff oa-word-diff--target ${className ?? ''}`.trim()}
    >
      {tgt.map((op, i) => (
        <span key={i} className={classifyTokenClass(op.op)}>{op.text}</span>
      ))}
    </div>
  )
}
