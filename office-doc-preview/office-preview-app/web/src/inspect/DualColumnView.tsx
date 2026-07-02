// 双栏对比视图 — 对标讯飞「翻译对比」设计稿
// 模型：claude-sonnet-4-6
//
// 核心原则（与设计稿一致）：
//   1. **每段一行**：左右两栏同一个 paragraph 在同一 grid 行 → 天然对齐
//   2. **段内字符级高亮**：差异处用红色（左/delete）/蓝色（右/insert）inline 高亮，
//      段落整体背景保持洁净 —— 设计稿做法（如「端 APP」案例）
//   3. **单滚动容器**：CSS Grid 一行两 cell，无需 JS 同步滚动
//   4. **完整文档流**：equal 段落正常显示文本，change 段落保留全文，不切片
//   5. **字符联动高亮**：hover 左侧第 N 个 delete → 右侧第 N 个 insert 同步高亮（反之亦然）
import { useState, useCallback, useEffect } from 'react'
import type { InspectDiffResponse, ParagraphDiffBlock, DiffOp } from '../types'

interface Props {
  diff: InspectDiffResponse | null
  loading: boolean
  loadError: string | null
  onRetry?: () => void
}

export function DualColumnView({ diff, loading, loadError, onRetry }: Props) {
  const [hoveredPair, setHoveredPair] = useState<number | null>(null)
  const [selectedPair, setSelectedPair] = useState<number | null>(null)

  const onTogglePair = useCallback((p: number | null) => {
    setSelectedPair(prev => prev === p ? null : p)
  }, [])

  // 直接用后端 paragraphBlocks，不再做任何切分
  const blocks: ParagraphDiffBlock[] = diff?.paragraphBlocks || []

  // 首次加载：自动选中第一个 change/delete/insert block
  useEffect(() => {
    if (!diff || blocks.length === 0) return
    const firstChangeIdx = blocks.findIndex(b => b.kind !== 'equal')
    if (firstChangeIdx >= 0) setSelectedPair(firstChangeIdx)
  }, [diff, blocks])

  // 所有非 equal block 的索引（用于 prev/next 导航）
  const changeIdxList = blocks
    .map((b, i) => b.kind !== 'equal' ? i : -1)
    .filter(i => i >= 0)
  const currentChangePos = selectedPair !== null
    ? changeIdxList.indexOf(selectedPair) + 1
    : 0
  const gotoChange = useCallback((delta: number) => {
    if (changeIdxList.length === 0) return
    const curIdx = selectedPair !== null ? changeIdxList.indexOf(selectedPair) : -1
    const nextIdx = Math.max(0, Math.min(changeIdxList.length - 1, curIdx + delta))
    console.info('[dual-column] goto delta=', delta, 'pos=', nextIdx + 1, '/', changeIdxList.length)
    setSelectedPair(changeIdxList[nextIdx])
    setTimeout(() => {
      const el = document.querySelector(`.dcv-para[data-pair-id="${changeIdxList[nextIdx]}"]`)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 0)
  }, [changeIdxList, selectedPair])

  const retryBtn = onRetry
    ? <button type="button" className="btn-mini" onClick={onRetry}>重试</button>
    : null

  return (
    <div className="dcv-container dcv-container-scroll" data-testid="dual-column-view">
      {loading && <div className="icm-msg">解析中…</div>}
      {!loading && loadError && (
        <div className="icm-msg icm-msg-err">加载失败：{loadError}{retryBtn}</div>
      )}
      {!loading && !loadError && blocks.length === 0 && (
        <div className="icm-msg">无内容</div>
      )}
      {!loading && !loadError && blocks.length > 0 && (
        <>
          {changeIdxList.length > 0 && (
            <div className="dcv-navbar">
              <button
                type="button"
                className="dcv-nav-btn"
                onClick={() => gotoChange(-1)}
                disabled={currentChangePos <= 1}
                aria-label="上一处差异"
              >↑ 上一处</button>
              <span className="dcv-nav-count">
                {currentChangePos > 0 ? `第 ${currentChangePos} / ${changeIdxList.length} 处差异` : `共 ${changeIdxList.length} 处差异`}
              </span>
              <button
                type="button"
                className="dcv-nav-btn"
                onClick={() => gotoChange(1)}
                disabled={currentChangePos === 0 || currentChangePos >= changeIdxList.length}
                aria-label="下一处差异"
              >↓ 下一处</button>
            </div>
          )}
          <div className="dcv-para-grid" data-testid="dual-column-grid">
            <div className="dcv-colhdr" data-testid="inspect-left">原文</div>
            <div className="dcv-colhdr dcv-colhdr-right" data-testid="inspect-right">译文 / 改正</div>
            {blocks.map((blk, i) => (
              <ParaRow
                key={i}
                block={blk}
                pairId={i}
                isHovered={hoveredPair === i}
                isSelected={selectedPair === i}
                onHover={setHoveredPair}
                onToggle={onTogglePair}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── 单个段落的左右两 cell（同一 grid 行） ─────────────────────────────────

function ParaRow({
  block, pairId, isHovered, isSelected, onHover, onToggle,
}: {
  block: ParagraphDiffBlock
  pairId: number
  isHovered: boolean
  isSelected: boolean
  onHover: (p: number | null) => void
  onToggle: (p: number | null) => void
}) {
  // 字符级联动高亮状态：当前 hover 的 diff 字符配对序号
  const [hoveredCharIdx, setHoveredCharIdx] = useState<number | null>(null)

  const interactive = block.kind !== 'equal'
  const sharedCls = [
    'dcv-para',
    isHovered ? 'dcv-para-pair-hover' : '',
    isSelected ? 'dcv-para-pair-sel' : '',
  ].filter(Boolean).join(' ')

  const handlers = interactive ? {
    onMouseEnter: () => onHover(pairId),
    onMouseLeave: () => { onHover(null); setHoveredCharIdx(null) },
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onToggle(pairId) },
  } : {}
  const roleAttrs = interactive ? { role: 'button', tabIndex: 0 } : {}

  return (
    <>
      <ParaCell side="left" block={block} pairId={pairId} sharedCls={sharedCls} handlers={handlers} roleAttrs={roleAttrs} hoveredCharIdx={hoveredCharIdx} onCharHover={setHoveredCharIdx} />
      <ParaCell side="right" block={block} pairId={pairId} sharedCls={sharedCls} handlers={handlers} roleAttrs={roleAttrs} hoveredCharIdx={hoveredCharIdx} onCharHover={setHoveredCharIdx} />
    </>
  )
}

function ParaCell({
  side, block, pairId, sharedCls, handlers, roleAttrs, hoveredCharIdx, onCharHover,
}: {
  side: 'left' | 'right'
  block: ParagraphDiffBlock
  pairId: number
  sharedCls: string
  handlers: React.HTMLAttributes<HTMLElement>
  roleAttrs: { role?: string; tabIndex?: number }
  hoveredCharIdx: number | null
  onCharHover: (idx: number | null) => void
}) {
  const text = side === 'left' ? block.leftText : block.rightText

  // 当前侧无内容（delete 在右 / insert 在左）→ 空占位 cell 维持行高
  if (!text) {
    return (
      <div
        className={`dcv-para dcv-para-empty dcv-para-empty-${block.kind} ${sharedCls}`}
        data-pair-id={pairId}
        data-side={side}
        aria-hidden="true"
      />
    )
  }

  const classes = [
    sharedCls,
    `dcv-para-${block.kind}`,
    side === 'left' ? 'dcv-para-side-left' : 'dcv-para-side-right',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      data-pair-id={pairId}
      data-side={side}
      {...roleAttrs}
      {...handlers}
    >
      {/* change block：用 charOps 渲染 inline 字符级 diff + 联动高亮；其他 block：纯文本 */}
      {block.kind === 'change' && block.charOps
        ? <CharDiffText ops={block.charOps} side={side} hoveredCharIdx={hoveredCharIdx} onCharHover={onCharHover} />
        : text}
    </div>
  )
}

/**
 * change block 内部字符级 diff 渲染（带联动高亮）
 *
 * 左栏显示 delete+equal，右栏显示 insert+equal。
 * 每个 non-equal op 获得一个 pairIdx（本侧 diff 序号），
 * 当 hoveredCharIdx === pairIdx 时添加 .dcv-char-hovered class 实现跨栏联动。
 */
function CharDiffText({
  ops, side, hoveredCharIdx, onCharHover,
}: {
  ops: DiffOp[]
  side: 'left' | 'right'
  hoveredCharIdx: number | null
  onCharHover: (idx: number | null) => void
}) {
  let diffCounter = 0 // 本侧 non-equal op 计数器 → 作为 pairIdx

  return (
    <>
      {ops.map((op, originalIdx) => {
        // 按侧过滤：左不显示 insert，右不显示 delete
        if (side === 'left' && op.op === 'insert') return null
        if (side === 'right' && op.op === 'delete') return null

        if (op.op === 'equal') return <span key={originalIdx}>{op.text}</span>

        // 非 equal op → 计算配对索引并渲染为高亮 span
        const currentPairIdx = diffCounter++
        const isHovered = hoveredCharIdx === currentPairIdx
        const cls = op.op === 'delete' ? 'dcv-char-delete' : 'dcv-char-insert'

        return (
          <span
            key={originalIdx}
            className={`${cls}${isHovered ? ' dcv-char-hovered' : ''}`}
            data-pair-idx={String(currentPairIdx)}
            onMouseEnter={() => onCharHover(currentPairIdx)}
            onMouseLeave={() => onCharHover(null)}
          >
            {op.text}
          </span>
        )
      })}
    </>
  )
}
