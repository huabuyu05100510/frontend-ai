// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRegisterTemplatesItems, registerTemplatesItems } from '../../../src/palette/sources/templates'
import { paletteRegistry } from '../../../src/palette/registry'

describe('templates source', () => {
  beforeEach(() => {
    paletteRegistry.clear()
  })

  it('imperative register creates 7 template items', () => {
    const nav = vi.fn()
    registerTemplatesItems(nav)
    const items = paletteRegistry.list()
    expect(items.length).toBe(7)
    for (const it of items) expect(it.group).toBe('模板')
  })

  it('action navigates to the target route', () => {
    const nav = vi.fn()
    registerTemplatesItems(nav)
    const translateItem = paletteRegistry.list().find(i => i.id === 'tpl-translate-new')
    expect(translateItem).toBeDefined()
    translateItem!.action()
    expect(nav).toHaveBeenCalledWith('/translate')
  })

  it('hook registers and unmount unregisters', () => {
    const { unmount } = renderHook(() => useRegisterTemplatesItems(), { wrapper: MemoryRouter })
    expect(paletteRegistry.list().length).toBe(7)
    unmount()
    expect(paletteRegistry.list().length).toBe(0)
  })
})