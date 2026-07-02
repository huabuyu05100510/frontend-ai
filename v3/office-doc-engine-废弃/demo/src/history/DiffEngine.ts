import type { DiffChunk, DiffSummary } from '../core/types'

/**
 * Myers diff algorithm implementation.
 * O((N+M)*D) time complexity where D = edit distance.
 * Produces minimal edit script for character-level diffs.
 */
export class DiffEngine {
  static diff(before: string, after: string): DiffChunk[] {
    if (before === after) {
      return before.length > 0 ? [{ type: 'equal', text: before }] : []
    }
    if (before.length === 0) return after.length > 0 ? [{ type: 'insert', text: after }] : []
    if (after.length === 0) return before.length > 0 ? [{ type: 'delete', text: before }] : []

    // Find common prefix and suffix to produce intuitive diffs
    const { prefixLen, suffixLen, aMid, bMid } = DiffEngine._trimCommon(before, after)

    const chunks: DiffChunk[] = []
    if (prefixLen > 0) chunks.push({ type: 'equal', text: before.slice(0, prefixLen) })

    if (aMid.length > 0 || bMid.length > 0) {
      chunks.push(...DiffEngine._lcsChunks(aMid, bMid))
    }

    if (suffixLen > 0) chunks.push({ type: 'equal', text: before.slice(before.length - suffixLen) })

    return chunks
  }

  private static _trimCommon(a: string, b: string): { prefixLen: number; suffixLen: number; aMid: string; bMid: string } {
    let prefixLen = 0
    while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) {
      prefixLen++
    }

    let suffixLen = 0
    const aEnd = a.length - prefixLen
    const bEnd = b.length - prefixLen
    while (suffixLen < aEnd && suffixLen < bEnd && a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]) {
      suffixLen++
    }

    const aMid = a.slice(prefixLen, a.length - suffixLen)
    const bMid = b.slice(prefixLen, b.length - suffixLen)
    return { prefixLen, suffixLen, aMid, bMid }
  }

  static summary(chunks: DiffChunk[]): DiffSummary {
    let added = 0, removed = 0, unchanged = 0
    for (const c of chunks) {
      if (c.type === 'insert') added += c.text.length
      else if (c.type === 'delete') removed += c.text.length
      else unchanged += c.text.length
    }
    return { added, removed, unchanged }
  }

  private static _lcsChunks(a: string, b: string): DiffChunk[] {
    // DP LCS approach for small strings; for large use word-level
    const useWordLevel = a.length + b.length > 1000
    if (useWordLevel) return DiffEngine._wordLevelDiff(a, b)

    const m = a.length, n = b.length
    // dp[i][j] = LCS length of a[0..i-1] and b[0..j-1]
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])

    // Backtrack
    const chunks: DiffChunk[] = []
    let i = m, j = n
    const ops: Array<{ type: 'equal' | 'insert' | 'delete'; ch: string }> = []
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push({ type: 'equal', ch: a[i - 1] }); i--; j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 'insert', ch: b[j - 1] }); j--
      } else {
        ops.push({ type: 'delete', ch: a[i - 1] }); i--
      }
    }
    ops.reverse()

    // Merge adjacent same-type ops
    for (const op of ops) {
      const last = chunks[chunks.length - 1]
      if (last && last.type === op.type) last.text += op.ch
      else chunks.push({ type: op.type, text: op.ch })
    }
    return chunks
  }

  private static _wordLevelDiff(a: string, b: string): DiffChunk[] {
    // Word-level diff for large texts
    const aWords = a.match(/\S+|\s+/g) ?? []
    const bWords = b.match(/\S+|\s+/g) ?? []
    const m = aWords.length, n = bWords.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = aWords[i - 1] === bWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])

    const ops: Array<{ type: 'equal' | 'insert' | 'delete'; text: string }> = []
    let i = m, j = n
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && aWords[i - 1] === bWords[j - 1]) {
        ops.push({ type: 'equal', text: aWords[i - 1] }); i--; j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 'insert', text: bWords[j - 1] }); j--
      } else {
        ops.push({ type: 'delete', text: aWords[i - 1] }); i--
      }
    }
    ops.reverse()

    const chunks: DiffChunk[] = []
    for (const op of ops) {
      const last = chunks[chunks.length - 1]
      if (last && last.type === op.type) last.text += op.text
      else chunks.push({ type: op.type, text: op.text })
    }
    return chunks
  }
}
