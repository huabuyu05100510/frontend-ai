import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentModel } from '../core/DocumentModel'
import type { Block } from '../core/types'

function makeBlock(partial: Partial<Block> & { id: string; type: Block['type'] }): Block {
  return {
    content: '',
    children: [],
    props: {},
    meta: { createdBy: 'test', createdAt: 0, updatedAt: 0, version: 1 },
    ...partial,
  }
}

describe('DocumentModel', () => {
  let doc: DocumentModel

  beforeEach(() => {
    doc = DocumentModel.empty('test-doc', 'Test Document')
  })

  // ── CRUD ───────────────────────────────────────────
  describe('Block CRUD', () => {
    it('creates empty document with root block', () => {
      expect(doc.getBlock(doc.rootId)).toBeDefined()
      expect(doc.stats().blockCount).toBe(1) // root only
    })

    it('inserts a paragraph block', () => {
      const op = doc.insertBlock(doc.rootId, 0, {
        type: 'paragraph',
        content: 'Hello world',
        children: [],
        props: {},
        meta: { createdBy: 'alice', createdAt: Date.now(), updatedAt: Date.now(), version: 1 },
      })
      expect(op.type).toBe('insert')
      const children = doc.getChildren(doc.rootId)
      expect(children).toHaveLength(1)
      expect(children[0].content).toBe('Hello world')
    })

    it('inserts multiple blocks maintaining order', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'b1', type: 'paragraph', content: 'first' }))
      doc.insertBlock(root, 1, makeBlock({ id: 'b2', type: 'paragraph', content: 'second' }))
      doc.insertBlock(root, 1, makeBlock({ id: 'b3', type: 'paragraph', content: 'middle' }))

      const children = doc.getChildren(root)
      expect(children.map(b => b.content)).toEqual(['first', 'middle', 'second'])
    })

    it('deletes a block', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'del-me', type: 'paragraph', content: 'to delete' }))
      expect(doc.getChildren(root)).toHaveLength(1)

      doc.deleteBlock('del-me')
      expect(doc.getChildren(root)).toHaveLength(0)
      expect(() => doc.getBlock('del-me')).toThrow()
    })

    it('deletes block cascades to children', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'parent', type: 'paragraph', content: 'parent' }))
      doc.insertBlock('parent', 0, makeBlock({ id: 'child', type: 'paragraph', content: 'child' }))

      doc.deleteBlock('parent')
      expect(() => doc.getBlock('child')).toThrow()
    })

    it('updates block content', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'upd', type: 'paragraph', content: 'old' }))
      doc.updateBlock('upd', { content: 'new content' })
      expect(doc.getBlock('upd').content).toBe('new content')
    })

    it('moves block to different position', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'a', type: 'paragraph', content: 'A' }))
      doc.insertBlock(root, 1, makeBlock({ id: 'b', type: 'paragraph', content: 'B' }))
      doc.insertBlock(root, 2, makeBlock({ id: 'c', type: 'paragraph', content: 'C' }))

      doc.moveBlock('a', root, 2) // move A to end
      const order = doc.getChildren(root).map(b => b.content)
      expect(order).toEqual(['B', 'C', 'A'])
    })
  })

  // ── Serialization ──────────────────────────────────
  describe('Serialization', () => {
    it('round-trips to/from JSON', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'p1', type: 'heading', content: 'Title', props: { level: 1 } }))
      doc.insertBlock(root, 1, makeBlock({ id: 'p2', type: 'paragraph', content: 'Body text' }))

      const json = doc.toJSON()
      const restored = DocumentModel.fromJSON(json)

      expect(restored.getBlock('p1').content).toBe('Title')
      expect(restored.getBlock('p2').content).toBe('Body text')
      expect(restored.getChildren(root).map(b => b.id)).toEqual(['p1', 'p2'])
    })

    it('handles empty document', () => {
      const json = doc.toJSON()
      const restored = DocumentModel.fromJSON(json)
      expect(restored.stats().blockCount).toBe(1)
    })

    it('preserves nested block structure', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'list', type: 'bullet_list', content: '' }))
      doc.insertBlock('list', 0, makeBlock({ id: 'li1', type: 'list_item', content: 'Item 1' }))
      doc.insertBlock('list', 1, makeBlock({ id: 'li2', type: 'list_item', content: 'Item 2' }))

      const restored = DocumentModel.fromJSON(doc.toJSON())
      expect(restored.getChildren('list').map(b => b.content)).toEqual(['Item 1', 'Item 2'])
    })
  })

  // ── Search ─────────────────────────────────────────
  describe('Search', () => {
    beforeEach(() => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 's1', type: 'paragraph', content: 'The quick brown fox' }))
      doc.insertBlock(root, 1, makeBlock({ id: 's2', type: 'paragraph', content: 'jumps over the lazy dog' }))
      doc.insertBlock(root, 2, makeBlock({ id: 's3', type: 'heading', content: 'Quick Summary', props: { level: 2 } }))
    })

    it('finds blocks matching query', () => {
      const results = doc.search('quick')
      expect(results).toHaveLength(2)
      expect(results.map(r => r.blockId)).toContain('s1')
      expect(results.map(r => r.blockId)).toContain('s3')
    })

    it('is case-insensitive', () => {
      expect(doc.search('QUICK')).toHaveLength(2)
      expect(doc.search('Quick')).toHaveLength(2)
    })

    it('returns empty for no match', () => {
      expect(doc.search('elephant')).toHaveLength(0)
    })

    it('returns match positions within block', () => {
      const results = doc.search('fox')
      expect(results[0].matchStart).toBeGreaterThanOrEqual(0)
      expect(results[0].matchEnd).toBeGreaterThan(results[0].matchStart)
    })
  })

  // ── Statistics ─────────────────────────────────────
  describe('Statistics', () => {
    it('counts words correctly', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'w1', type: 'paragraph', content: 'Hello world foo' }))
      doc.insertBlock(root, 1, makeBlock({ id: 'w2', type: 'paragraph', content: 'bar baz' }))
      expect(doc.stats().wordCount).toBe(5)
    })

    it('counts characters (no spaces)', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'c1', type: 'paragraph', content: 'abc def' }))
      // 6 non-space chars
      expect(doc.stats().charCount).toBe(6)
    })

    it('returns 0 stats for empty document', () => {
      const s = doc.stats()
      expect(s.wordCount).toBe(0)
      expect(s.charCount).toBe(0)
    })

    it('counts blocks correctly', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'x1', type: 'paragraph', content: 'a' }))
      doc.insertBlock(root, 1, makeBlock({ id: 'x2', type: 'paragraph', content: 'b' }))
      expect(doc.stats().blockCount).toBe(3) // root + 2
    })
  })

  // ── Path / Ancestry ────────────────────────────────
  describe('Block path', () => {
    it('returns root-to-node path', () => {
      const root = doc.rootId
      doc.insertBlock(root, 0, makeBlock({ id: 'p', type: 'paragraph', content: '' }))
      doc.insertBlock('p', 0, makeBlock({ id: 'child', type: 'list_item', content: '' }))

      const path = doc.getPath('child')
      expect(path).toEqual([root, 'p', 'child'])
    })

    it('returns single-element path for root', () => {
      expect(doc.getPath(doc.rootId)).toEqual([doc.rootId])
    })
  })
})
