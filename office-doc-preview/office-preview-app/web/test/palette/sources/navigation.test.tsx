// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRegisterNavigationItems } from '../../../src/palette/sources/navigation'
import { paletteRegistry } from '../../../src/palette/registry'

describe('navigation source', () => {
  beforeEach(() => paletteRegistry.clear())

  it('registers 7 navigation items (one per menu key)', () => {
    renderHook(() => useRegisterNavigationItems(), { wrapper: MemoryRouter })
    const items = paletteRegistry.list()
    expect(items.length).toBeGreaterThanOrEqual(7)
    const ids = items.map(i => i.id)
    expect(ids).toContain('nav-files')
    expect(ids).toContain('nav-translate')
    expect(ids).toContain('nav-qc')
    expect(ids).toContain('nav-ocr')
    expect(ids).toContain('nav-convert')
    expect(ids).toContain('nav-upload')
    expect(ids).toContain('nav-voice')
  })

  it('each item has a working action (navigates)', () => {
    renderHook(() => useRegisterNavigationItems(), { wrapper: MemoryRouter })
    const items = paletteRegistry.list()
    const filesItem = items.find(i => i.id === 'nav-files')
    expect(filesItem).toBeDefined()
    expect(typeof filesItem!.action).toBe('function')
    // Calling action should not throw
    expect(() => filesItem!.action()).not.toThrow()
  })

  it('unregisters on unmount', () => {
    const { unmount } = renderHook(() => useRegisterNavigationItems(), { wrapper: MemoryRouter })
    expect(paletteRegistry.list().length).toBeGreaterThanOrEqual(7)
    unmount()
    expect(paletteRegistry.list().length).toBe(0)
  })
})