// ─────────────────────────────────────────────────────────────────────────────
// OT Engine — Operational Transformation (pure functions, zero external deps)
//
// Algorithm: Jupiter/dOPT simplified for linear text
// Convergence property: apply(apply(doc, opA), T(opB,opA)) ≡ apply(apply(doc, opB), T(opA,opB))
// ─────────────────────────────────────────────────────────────────────────────

export type Op =
  | { type: 'retain'; n: number }
  | { type: 'insert'; text: string }
  | { type: 'delete'; n: number }

export type OperationList = Op[]

export class OTEngine {
  // ── apply ──────────────────────────────────────────────────────────────
  static apply(doc: string, ops: OperationList): string {
    let result = ''
    let pos = 0
    for (const op of ops) {
      if (op.type === 'retain') {
        if (pos + op.n > doc.length) throw new Error(`retain(${op.n}) exceeds remaining doc length`)
        result += doc.slice(pos, pos + op.n)
        pos += op.n
      } else if (op.type === 'insert') {
        result += op.text
      } else {
        if (pos + op.n > doc.length) throw new Error(`delete(${op.n}) exceeds remaining doc length`)
        pos += op.n
      }
    }
    result += doc.slice(pos)
    return result
  }

  // ── validate ──────────────────────────────────────────────────────────
  static validate(ops: OperationList, docLen: number): boolean {
    let consumed = 0
    for (const op of ops) {
      if (op.type === 'retain') {
        consumed += op.n
        if (consumed > docLen) return false
      } else if (op.type === 'delete') {
        consumed += op.n
        if (consumed > docLen) return false
      }
    }
    return true
  }

  // ── transform ─────────────────────────────────────────────────────────
  /**
   * Transform two concurrent operations so they can be applied in either order.
   * Returns [opA', opB'] where:
   *   apply(apply(doc, opA), opB') ≡ apply(apply(doc, opB), opA')
   *
   * Tie-breaking: opA wins at equal positions (Alice-priority)
   */
  static transform(opA: OperationList, opB: OperationList): [OperationList, OperationList] {
    const aPrime: OperationList = []
    const bPrime: OperationList = []

    let ia = 0, ib = 0
    let headA: Op | null = opA[ia++] ?? null
    let headB: Op | null = opB[ib++] ?? null

    while (headA !== null || headB !== null) {
      if (headA === null) {
        if (headB !== null) {
          bPrime.push(headB)
          if (headB.type === 'insert') aPrime.push({ type: 'retain', n: headB.text.length })
          headB = opB[ib++] ?? null
        }
        continue
      }
      if (headB === null) {
        aPrime.push(headA)
        if (headA.type === 'insert') bPrime.push({ type: 'retain', n: headA.text.length })
        headA = opA[ia++] ?? null
        continue
      }

      // A inserts → insert into A', add retain to B'
      if (headA.type === 'insert') {
        aPrime.push(headA)
        bPrime.push({ type: 'retain', n: headA.text.length })
        headA = opA[ia++] ?? null
        continue
      }

      // B inserts → insert into B', add retain to A'
      if (headB.type === 'insert') {
        bPrime.push(headB)
        aPrime.push({ type: 'retain', n: headB.text.length })
        headB = opB[ib++] ?? null
        continue
      }

      // Both consuming (retain or delete)
      const lenA = headA.n
      const lenB = headB.n
      const min = Math.min(lenA, lenB)

      if (headA.type === 'retain' && headB.type === 'retain') {
        aPrime.push({ type: 'retain', n: min })
        bPrime.push({ type: 'retain', n: min })
      } else if (headA.type === 'delete' && headB.type === 'delete') {
        // Both delete same range — both primes skip
      } else if (headA.type === 'delete' && headB.type === 'retain') {
        aPrime.push({ type: 'delete', n: min })
        // B' skips what A deleted
      } else if (headA.type === 'retain' && headB.type === 'delete') {
        bPrime.push({ type: 'delete', n: min })
        // A' skips what B deleted
      }

      headA = OTEngine._advance(headA, min) ?? (opA[ia++] ?? null)
      headB = OTEngine._advance(headB, min) ?? (opB[ib++] ?? null)
    }

    return [OTEngine._normalize(aPrime), OTEngine._normalize(bPrime)]
  }

  // ── compose ────────────────────────────────────────────────────────────
  static compose(op1: OperationList, op2: OperationList): OperationList {
    const result: OperationList = []
    let i1 = 0, i2 = 0
    let h1: Op | null = op1[i1++] ?? null
    let h2: Op | null = op2[i2++] ?? null

    while (h1 !== null || h2 !== null) {
      if (h1 === null) { if (h2) { result.push(h2); h2 = op2[i2++] ?? null } ; continue }
      if (h2 === null) { if (h1) { result.push(h1); h1 = op1[i1++] ?? null } ; continue }

      if (h1.type === 'delete') { result.push(h1); h1 = op1[i1++] ?? null; continue }
      if (h2.type === 'insert') { result.push(h2); h2 = op2[i2++] ?? null; continue }

      if (h1.type === 'insert') {
        if (h2.type === 'retain') {
          const min = Math.min(h1.text.length, h2.n)
          result.push({ type: 'insert', text: h1.text.slice(0, min) })
          h1 = OTEngine._advance(h1, min) ?? (op1[i1++] ?? null)
          h2 = OTEngine._advance(h2, min) ?? (op2[i2++] ?? null)
        } else { // h2 delete
          const min = Math.min(h1.text.length, h2.n)
          h1 = OTEngine._advance(h1, min) ?? (op1[i1++] ?? null)
          h2 = OTEngine._advance(h2, min) ?? (op2[i2++] ?? null)
        }
      } else { // h1 retain
        const min = Math.min(h1.n, h2.n)
        if (h2.type === 'retain') result.push({ type: 'retain', n: min })
        else result.push({ type: 'delete', n: min })
        h1 = OTEngine._advance(h1, min) ?? (op1[i1++] ?? null)
        h2 = OTEngine._advance(h2, min) ?? (op2[i2++] ?? null)
      }
    }

    return OTEngine._normalize(result)
  }

  // ── invert ─────────────────────────────────────────────────────────────
  static invert(ops: OperationList, doc: string): OperationList {
    const inverse: OperationList = []
    let pos = 0
    for (const op of ops) {
      if (op.type === 'retain') {
        inverse.push({ type: 'retain', n: op.n })
        pos += op.n
      } else if (op.type === 'insert') {
        inverse.push({ type: 'delete', n: op.text.length })
      } else {
        inverse.push({ type: 'insert', text: doc.slice(pos, pos + op.n) })
        pos += op.n
      }
    }
    return OTEngine._normalize(inverse)
  }

  // ── Private helpers ────────────────────────────────────────────────────
  private static _advance(op: Op, n: number): Op | null {
    if (op.type === 'insert') {
      return op.text.length > n ? { type: 'insert', text: op.text.slice(n) } : null
    }
    const remaining = op.n - n
    return remaining > 0 ? ({ ...op, n: remaining } as Op) : null
  }

  private static _normalize(ops: OperationList): OperationList {
    const result: Op[] = []
    for (const op of ops) {
      const last = result[result.length - 1]
      if (last && op.type === 'retain' && last.type === 'retain') {
        (last as { type: 'retain'; n: number }).n += op.n
      } else if (last && op.type === 'insert' && last.type === 'insert') {
        (last as { type: 'insert'; text: string }).text += op.text
      } else if (last && op.type === 'delete' && last.type === 'delete') {
        (last as { type: 'delete'; n: number }).n += op.n
      } else {
        result.push({ ...op } as Op)
      }
    }
    return result.filter(op =>
      op.type === 'insert' ? op.text.length > 0 : op.n > 0
    )
  }
}
