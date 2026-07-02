import type { EditOp } from '../kernel/types'

// ============================================================================
// EditOp — 统一编辑操作的取反（撤销）与应用
//   所有编辑都是可逆 Op：undo = 应用 invert(op)，redo = 再应用 op。
//   非破坏性：底图只读，Op 序列即编辑历史。
// ============================================================================

export function invert(op: EditOp): EditOp {
  switch (op.kind) {
    case 'annot.add':
      return { ...op, kind: 'annot.remove' }
    case 'annot.remove':
      return { ...op, kind: 'annot.add' }
    case 'text.splice':
      return { kind: 'text.splice', blockId: op.blockId, at: op.at, del: op.ins, ins: op.del }
    case 'cell.set':
      return { kind: 'cell.set', sheet: op.sheet, r: op.r, c: op.c, before: op.value, value: op.before }
    case 'cue.edit':
      return { kind: 'cue.edit', id: op.id, before: op.after, after: op.before }
    case 'mark.add':
      return { ...op, kind: 'mark.remove' }
    case 'mark.remove':
      return { ...op, kind: 'mark.add' }
  }
}

/** 将 text.splice 应用到字符串（其他 kind 原样返回，非文本操作不影响文本） */
export function applyText(text: string, op: EditOp): string {
  if (op.kind !== 'text.splice') return text
  const head = text.slice(0, op.at)
  const removed = text.slice(op.at, op.at + op.del.length)
  if (removed !== op.del) {
    throw new Error(`applyText 冲突：期望删除 "${op.del}" 实际 "${removed}"`)
  }
  const tail = text.slice(op.at + op.del.length)
  return head + op.ins + tail
}
