import { describe, it, expect } from 'vitest'
import { OTEngine, type OperationList } from '../ot/OTEngine'

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function ins(pos: number, text: string): OperationList {
  const ops: OperationList = []
  if (pos > 0) ops.push({ type: 'retain', n: pos })
  ops.push({ type: 'insert', text })
  return ops
}

function del(pos: number, n: number): OperationList {
  const ops: OperationList = []
  if (pos > 0) ops.push({ type: 'retain', n: pos })
  ops.push({ type: 'delete', n })
  return ops
}

// ─────────────────────────────────────────
// apply
// ─────────────────────────────────────────
describe('OTEngine.apply', () => {
  it('applies insert at beginning', () => {
    expect(OTEngine.apply('hello', [{ type: 'insert', text: 'say ' }])).toBe('say hello')
  })

  it('applies insert at end', () => {
    expect(OTEngine.apply('hello', [{ type: 'retain', n: 5 }, { type: 'insert', text: '!' }])).toBe('hello!')
  })

  it('applies insert in middle', () => {
    expect(OTEngine.apply('helo', ins(3, 'l'))).toBe('hello')
  })

  it('applies delete', () => {
    expect(OTEngine.apply('hello world', del(5, 6))).toBe('hello')
  })

  it('applies retain only (noop)', () => {
    expect(OTEngine.apply('abc', [{ type: 'retain', n: 3 }])).toBe('abc')
  })

  it('applies insert + delete combo', () => {
    // "hello" → delete "hell" + insert "hy" → "hyo" (pos0: delete4 then insert hy)
    const doc = 'hello'
    const ops: OperationList = [
      { type: 'insert', text: 'hi ' },
      { type: 'delete', n: 5 },
    ]
    expect(OTEngine.apply(doc, ops)).toBe('hi ')
  })

  it('throws on over-retain', () => {
    expect(() => OTEngine.apply('hi', [{ type: 'retain', n: 10 }])).toThrow()
  })
})

// ─────────────────────────────────────────
// validate
// ─────────────────────────────────────────
describe('OTEngine.validate', () => {
  it('accepts valid retain', () => {
    expect(OTEngine.validate([{ type: 'retain', n: 5 }], 5)).toBe(true)
  })

  it('rejects retain > docLen', () => {
    expect(OTEngine.validate([{ type: 'retain', n: 10 }], 5)).toBe(false)
  })

  it('accepts insert (no docLen consumption)', () => {
    expect(OTEngine.validate([{ type: 'insert', text: 'xyz' }], 0)).toBe(true)
  })

  it('rejects delete > remaining', () => {
    expect(OTEngine.validate([{ type: 'delete', n: 10 }], 5)).toBe(false)
  })
})

// ─────────────────────────────────────────
// transform — convergence
// ─────────────────────────────────────────
describe('OTEngine.transform — convergence', () => {
  /**
   * 收敛定理：apply(apply(doc, opA), T(opB, opA)) === apply(apply(doc, opB), T(opA, opB))
   */
  function assertConverges(doc: string, opA: OperationList, opB: OperationList) {
    const [opAPrime, opBPrime] = OTEngine.transform(opA, opB)
    const stateA = OTEngine.apply(OTEngine.apply(doc, opA), opBPrime)
    const stateB = OTEngine.apply(OTEngine.apply(doc, opB), opAPrime)
    expect(stateA).toBe(stateB)
    return stateA
  }

  it('concurrent inserts at same position (Alice-priority)', () => {
    const result = assertConverges('hello', ins(3, 'X'), ins(3, 'Y'))
    // Both inserts must be present in final doc
    expect(result).toContain('X')
    expect(result).toContain('Y')
    expect(result).toContain('hel')
    expect(result).toContain('lo')
  })

  it('concurrent inserts at different positions', () => {
    const result = assertConverges('abcde', ins(1, 'X'), ins(3, 'Y'))
    expect(result).toBe('aXbcYde')
  })

  it('insert vs delete non-overlapping', () => {
    // doc = "hello world"
    const result = assertConverges('hello world', ins(5, '!!!'), del(6, 5))
    expect(result).toContain('!!!')
    expect(result).not.toContain('world')
  })

  it('insert vs delete overlapping (insert inside deleted range)', () => {
    // doc = "abcde", Alice inserts at 2, Bob deletes 0-4
    assertConverges('abcde', ins(2, 'X'), del(0, 4))
  })

  it('concurrent deletes overlapping', () => {
    // doc = "hello world", both delete part of "world"
    assertConverges('hello world', del(6, 3), del(7, 4))
  })

  it('empty operations are identity', () => {
    const doc = 'hello'
    const [a, b] = OTEngine.transform([], [])
    expect(OTEngine.apply(doc, a)).toBe(doc)
    expect(OTEngine.apply(doc, b)).toBe(doc)
  })

  it('property test: 50 random operation pairs converge', () => {
    const chars = 'abcdefghij'
    for (let i = 0; i < 50; i++) {
      const doc = chars.slice(0, 3 + (i % 7))
      const pos1 = Math.floor(Math.random() * (doc.length + 1))
      const pos2 = Math.floor(Math.random() * (doc.length + 1))
      const opA = ins(pos1, 'A')
      const opB = ins(pos2, 'B')
      assertConverges(doc, opA, opB)
    }
  })
})

// ─────────────────────────────────────────
// compose
// ─────────────────────────────────────────
describe('OTEngine.compose', () => {
  it('composes two inserts sequentially', () => {
    const doc = 'abc'
    const op1 = ins(0, 'X')
    const op2 = ins(1, 'Y')    // after applying op1: "Xabc", insert at 1 → "XYabc"
    const composed = OTEngine.compose(op1, op2)
    const direct = OTEngine.apply(OTEngine.apply(doc, op1), op2)
    expect(OTEngine.apply(doc, composed)).toBe(direct)
  })

  it('composes insert then delete', () => {
    const doc = 'hello'
    const op1 = ins(5, ' world')  // → 'hello world'
    const op2 = del(5, 6)          // → 'hello'
    const composed = OTEngine.compose(op1, op2)
    expect(OTEngine.apply(doc, composed)).toBe('hello')
  })
})

// ─────────────────────────────────────────
// invert
// ─────────────────────────────────────────
describe('OTEngine.invert', () => {
  it('inverts an insert (produces equivalent delete)', () => {
    const doc = 'hello'
    const op = ins(2, 'XY')
    const applied = OTEngine.apply(doc, op)   // 'heXYllo'
    const inv = OTEngine.invert(op, doc)
    expect(OTEngine.apply(applied, inv)).toBe(doc)
  })

  it('inverts a delete (produces equivalent insert)', () => {
    const doc = 'hello world'
    const op = del(5, 6)
    const applied = OTEngine.apply(doc, op)   // 'hello'
    const inv = OTEngine.invert(op, doc)
    expect(OTEngine.apply(applied, inv)).toBe(doc)
  })
})
