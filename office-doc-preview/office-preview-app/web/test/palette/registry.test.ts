// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach } from 'vitest'
import { paletteRegistry, registerPaletteItems, type PaletteItem } from '../../src/palette/registry'

describe('palette registry', () => {
  beforeEach(() => {
    paletteRegistry.clear()
  })

  it('starts empty', () => {
    expect(paletteRegistry.list()).toEqual([])
  })

  it('registerPaletteItems adds items', () => {
    const items: PaletteItem[] = [
      { id: 'test-1', title: 'Test 1', group: 'Actions', action: () => {} },
    ]
    registerPaletteItems(items)
    expect(paletteRegistry.list()).toHaveLength(1)
    expect(paletteRegistry.list()[0].id).toBe('test-1')
  })

  it('search filters by title (case-insensitive)', () => {
    registerPaletteItems([
      { id: 'a', title: 'Open Files', group: 'Navigation', action: () => {} },
      { id: 'b', title: 'Run Translate', group: 'Actions', action: () => {} },
    ])
    const results = paletteRegistry.search('files')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('a')
  })

  it('search matches by group', () => {
    registerPaletteItems([
      { id: 'a', title: 'Foo', group: 'Navigation', action: () => {} },
      { id: 'b', title: 'Bar', group: 'Settings', action: () => {} },
    ])
    expect(paletteRegistry.search('nav')).toHaveLength(1)
  })
})