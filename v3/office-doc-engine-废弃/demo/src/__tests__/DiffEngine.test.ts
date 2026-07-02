import { describe, it, expect } from 'vitest'
import { DiffEngine } from '../history/DiffEngine'

describe('DiffEngine', () => {
  describe('diff()', () => {
    it('identifies equal content', () => {
      const chunks = DiffEngine.diff('hello', 'hello')
      expect(chunks.every(c => c.type === 'equal')).toBe(true)
    })

    it('identifies pure insertion', () => {
      const chunks = DiffEngine.diff('hello', 'hello world')
      const inserts = chunks.filter(c => c.type === 'insert')
      expect(inserts.length).toBeGreaterThan(0)
      expect(inserts.map(c => c.text).join('')).toContain('world')
    })

    it('identifies pure deletion', () => {
      const chunks = DiffEngine.diff('hello world', 'hello')
      const deletes = chunks.filter(c => c.type === 'delete')
      expect(deletes.length).toBeGreaterThan(0)
      expect(deletes.map(c => c.text).join('')).toContain('world')
    })

    it('handles both insertion and deletion', () => {
      const chunks = DiffEngine.diff('cat', 'car')
      const types = new Set(chunks.map(c => c.type))
      expect(types.has('delete')).toBe(true)
      expect(types.has('insert')).toBe(true)
    })

    it('handles empty before', () => {
      const chunks = DiffEngine.diff('', 'new content')
      expect(chunks.every(c => c.type === 'insert' || c.type === 'equal')).toBe(true)
    })

    it('handles empty after', () => {
      const chunks = DiffEngine.diff('old content', '')
      expect(chunks.every(c => c.type === 'delete' || c.type === 'equal')).toBe(true)
    })

    it('handles both empty', () => {
      expect(DiffEngine.diff('', '')).toEqual([])
    })

    it('reconstructs "after" string from diff', () => {
      const before = 'The quick brown fox'
      const after = 'The slow red fox jumped'
      const chunks = DiffEngine.diff(before, after)
      const reconstructed = chunks
        .filter(c => c.type !== 'delete')
        .map(c => c.text)
        .join('')
      expect(reconstructed).toBe(after)
    })

    it('reconstructs "before" string from diff', () => {
      const before = 'Hello world'
      const after = 'Hello there'
      const chunks = DiffEngine.diff(before, after)
      const reconstructed = chunks
        .filter(c => c.type !== 'insert')
        .map(c => c.text)
        .join('')
      expect(reconstructed).toBe(before)
    })
  })

  describe('summary()', () => {
    it('counts added and removed characters', () => {
      const chunks = DiffEngine.diff('hello', 'hello world')
      const s = DiffEngine.summary(chunks)
      expect(s.added).toBe(6) // ' world'
      expect(s.removed).toBe(0)
    })

    it('returns zero changes for identical text', () => {
      const s = DiffEngine.summary(DiffEngine.diff('same', 'same'))
      expect(s.added).toBe(0)
      expect(s.removed).toBe(0)
    })

    it('counts unchanged characters', () => {
      const s = DiffEngine.summary(DiffEngine.diff('abc', 'abc'))
      expect(s.unchanged).toBe(3)
    })
  })
})
