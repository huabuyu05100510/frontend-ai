import { describe, it, expect } from 'vitest'
import { invert, applyText } from '../EditOp'
import type { EditOp } from '../../kernel/types'

describe('EditOp.invert（撤销取反）', () => {
  it('annot.add ↔ annot.remove', () => {
    const op: EditOp = {
      kind: 'annot.add',
      id: 'a1',
      anchor: { page: 1, xPct: 0.1, yPct: 0.2 },
      shape: { type: 'highlight', color: '#ff0' },
    }
    const inv = invert(op)
    expect(inv.kind).toBe('annot.remove')
    expect(invert(inv)).toEqual(op) // 双取反还原
  })

  it('text.splice：交换 del/ins', () => {
    const op: EditOp = { kind: 'text.splice', blockId: 'b1', at: 3, del: 'abc', ins: 'XY' }
    const inv = invert(op)
    expect(inv).toEqual({ kind: 'text.splice', blockId: 'b1', at: 3, del: 'XY', ins: 'abc' })
    expect(invert(inv)).toEqual(op)
  })

  it('cell.set：交换 before/value', () => {
    const op: EditOp = { kind: 'cell.set', sheet: 'S1', r: 2, c: 3, before: 1, value: 99 }
    expect(invert(op)).toEqual({ kind: 'cell.set', sheet: 'S1', r: 2, c: 3, before: 99, value: 1 })
  })

  it('cue.edit：交换 before/after', () => {
    const op: EditOp = {
      kind: 'cue.edit',
      id: 'c1',
      before: { start: 0, end: 1, text: 'a' },
      after: { start: 0.5, end: 2, text: 'b' },
    }
    const inv = invert(op)
    expect(inv).toEqual({
      kind: 'cue.edit',
      id: 'c1',
      before: { start: 0.5, end: 2, text: 'b' },
      after: { start: 0, end: 1, text: 'a' },
    })
  })

  it('mark.add ↔ mark.remove', () => {
    const op: EditOp = { kind: 'mark.add', id: 'm1', t: 12.5, label: '高潮' }
    const inv = invert(op)
    expect(inv.kind).toBe('mark.remove')
    expect(invert(inv)).toEqual(op)
  })
})

describe('EditOp.applyText + undo 闭环', () => {
  it('应用 text.splice 后再应用其逆操作 → 还原原文', () => {
    const original = 'hello world'
    const op: EditOp = { kind: 'text.splice', blockId: 'b', at: 6, del: 'world', ins: '世界' }
    const after = applyText(original, op)
    expect(after).toBe('hello 世界')
    const restored = applyText(after, invert(op))
    expect(restored).toBe(original)
  })

  it('纯插入与纯删除互为逆', () => {
    const insert: EditOp = { kind: 'text.splice', blockId: 'b', at: 0, del: '', ins: 'Hi ' }
    const s1 = applyText('there', insert)
    expect(s1).toBe('Hi there')
    expect(applyText(s1, invert(insert))).toBe('there')
  })

  it('连续操作的逆序撤销栈', () => {
    let s = 'abc'
    const ops: EditOp[] = [
      { kind: 'text.splice', blockId: 'b', at: 3, del: '', ins: 'd' }, // abcd
      { kind: 'text.splice', blockId: 'b', at: 0, del: 'a', ins: 'A' }, // Abcd
    ]
    for (const op of ops) s = applyText(s, op)
    expect(s).toBe('Abcd')
    // 逆序撤销
    for (let i = ops.length - 1; i >= 0; i--) s = applyText(s, invert(ops[i]))
    expect(s).toBe('abc')
  })
})
