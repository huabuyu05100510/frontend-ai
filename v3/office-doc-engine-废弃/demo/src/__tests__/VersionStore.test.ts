import { describe, it, expect, beforeEach } from 'vitest'
import { VersionStore } from '../history/VersionStore'

const makeContent = (text: string) => ({ title: 'Doc', body: text, version: 1 })

describe('VersionStore', () => {
  let store: VersionStore

  beforeEach(() => {
    store = new VersionStore({ maxSnapshots: 5 })
  })

  // ── snapshot ───────────────────────────────────────
  describe('snapshot()', () => {
    it('creates a snapshot and returns its id', () => {
      const id = store.snapshot(makeContent('hello'), 'alice')
      expect(id).toBeTruthy()
    })

    it('content-addressed: same content yields same id', () => {
      const content = makeContent('identical')
      const id1 = store.snapshot(content, 'alice')
      const id2 = store.snapshot(content, 'bob')
      expect(id1).toBe(id2)
    })

    it('different content yields different id', () => {
      const id1 = store.snapshot(makeContent('aaa'), 'alice')
      const id2 = store.snapshot(makeContent('bbb'), 'alice')
      expect(id1).not.toBe(id2)
    })
  })

  // ── list ───────────────────────────────────────────
  describe('list()', () => {
    it('returns snapshots in reverse-chronological order', () => {
      store.snapshot(makeContent('v1'), 'alice')
      store.snapshot(makeContent('v2'), 'alice')
      store.snapshot(makeContent('v3'), 'alice')
      const list = store.list()
      expect(list[0].content.body).toBe('v3')
      expect(list[2].content.body).toBe('v1')
    })

    it('returns empty list for new store', () => {
      expect(store.list()).toHaveLength(0)
    })
  })

  // ── get ────────────────────────────────────────────
  describe('get()', () => {
    it('retrieves snapshot by id', () => {
      const id = store.snapshot(makeContent('data'), 'alice')
      const snap = store.get(id)
      expect(snap?.content.body).toBe('data')
    })

    it('returns undefined for unknown id', () => {
      expect(store.get('nonexistent')).toBeUndefined()
    })
  })

  // ── LRU eviction ───────────────────────────────────
  describe('LRU eviction', () => {
    it('evicts oldest when exceeding maxSnapshots', () => {
      for (let i = 1; i <= 6; i++) {
        store.snapshot(makeContent(`v${i}`), 'alice')
      }
      const list = store.list()
      expect(list.length).toBeLessThanOrEqual(5)
      // v1 (oldest) should be evicted
      expect(list.map(s => s.content.body)).not.toContain('v1')
    })

    it('never evicts pinned snapshots', () => {
      const pinnedId = store.snapshot(makeContent('pinned-version'), 'alice')
      store.pin(pinnedId)
      for (let i = 0; i < 10; i++) {
        store.snapshot(makeContent(`auto-${i}`), 'alice')
      }
      expect(store.get(pinnedId)).toBeDefined()
    })

    it('evicts oldest non-pinned first', () => {
      const ids: string[] = []
      for (let i = 1; i <= 4; i++) {
        ids.push(store.snapshot(makeContent(`v${i}`), 'alice'))
      }
      store.pin(ids[0]) // pin v1 (oldest)
      store.snapshot(makeContent('v5'), 'alice')
      store.snapshot(makeContent('v6'), 'alice') // triggers eviction

      // v1 still exists (pinned), v2 should be evicted
      expect(store.get(ids[0])).toBeDefined()
      expect(store.get(ids[1])).toBeUndefined()
    })
  })

  // ── restore ────────────────────────────────────────
  describe('restore()', () => {
    it('returns the content from a previous snapshot', () => {
      const id = store.snapshot(makeContent('original content'), 'alice')
      store.snapshot(makeContent('modified content'), 'alice')

      const restored = store.restore(id)
      expect(restored.body).toBe('original content')
    })

    it('throws for unknown snapshot id', () => {
      expect(() => store.restore('bad-id')).toThrow()
    })
  })

  // ── label ──────────────────────────────────────────
  describe('label()', () => {
    it('allows custom labels on snapshots', () => {
      const id = store.snapshot(makeContent('release'), 'alice')
      store.label(id, '发布前版本 v2.0')
      expect(store.get(id)?.label).toBe('发布前版本 v2.0')
    })

    it('auto-generates label when not provided', () => {
      const id = store.snapshot(makeContent('auto'), 'alice')
      expect(store.get(id)?.label).toBeTruthy()
    })
  })
})
