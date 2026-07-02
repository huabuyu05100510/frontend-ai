// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRegisterActionsItems, registerActionsItems } from '../../../src/palette/sources/actions'
import { paletteRegistry } from '../../../src/palette/registry'

describe('actions source', () => {
  beforeEach(() => {
    paletteRegistry.clear()
    localStorage.clear()
  })

  it('imperative register creates 2 action items', () => {
    registerActionsItems({ toggleTheme: () => {}, toggleMotion: () => {} })
    const items = paletteRegistry.list()
    expect(items.length).toBe(2)
    for (const i of items) expect(i.group).toBe('操作')
  })

  it('action toggleTheme callback is invoked', () => {
    const toggleTheme = vi.fn()
    registerActionsItems({ toggleTheme, toggleMotion: () => {} })
    const item = paletteRegistry.list().find(i => i.id === 'action-toggle-theme')
    expect(item).toBeDefined()
    item!.action()
    expect(toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('action toggleMotion callback is invoked', () => {
    const toggleMotion = vi.fn()
    registerActionsItems({ toggleTheme: () => {}, toggleMotion })
    const item = paletteRegistry.list().find(i => i.id === 'action-toggle-motion')
    item!.action()
    expect(toggleMotion).toHaveBeenCalledTimes(1)
  })

  it('hook registers and unmount unregisters', () => {
    const { unmount } = renderHook(() => useRegisterActionsItems(), { wrapper: MemoryRouter })
    expect(paletteRegistry.list().length).toBe(2)
    unmount()
    expect(paletteRegistry.list().length).toBe(0)
  })

  it('toggleMotion integration flips localStorage', async () => {
    // Import dynamically so we can spy on localStorage
    const { useRegisterActionsItems: hook } = await import('../../../src/palette/sources/actions')
    const { act } = await import('@testing-library/react')
    const { result } = renderHook(() => hook(), { wrapper: MemoryRouter })
    // dispatch the event the action would dispatch — but easier: call the underlying localStorage toggle directly via the registry
    const items = paletteRegistry.list()
    expect(items.length).toBe(2)
    // call action — this triggers toggleMotion which writes to LS
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await act(async () => {
      items.find(i => i.id === 'action-toggle-motion')!.action()
    })
    // localStorage should now be 'on' (default was undefined → flips to 'on')
    expect(localStorage.getItem('motion')).toBe('on')
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'palette:motion-toggled' }))
  })
})