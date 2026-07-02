// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRegisterVoicesItems, registerVoicesItems } from '../../../src/palette/sources/voices'
import { paletteRegistry } from '../../../src/palette/registry'

describe('voices source', () => {
  beforeEach(() => {
    paletteRegistry.clear()
  })

  it('imperative register creates 4 voice items', () => {
    registerVoicesItems(vi.fn())
    const items = paletteRegistry.list()
    expect(items.length).toBe(4)
    for (const i of items) expect(i.group).toBe('语音')
  })

  it('action callback navigates or dispatches event', () => {
    const nav = vi.fn()
    registerVoicesItems(nav)
    const item = paletteRegistry.list().find(i => i.id === 'voice-open-center')
    expect(item).toBeDefined()
    item!.action()
    expect(nav).toHaveBeenCalledWith('/voice')
  })

  it('hook registers and unmount unregisters', () => {
    const { unmount } = renderHook(() => useRegisterVoicesItems(), { wrapper: MemoryRouter })
    expect(paletteRegistry.list().length).toBe(4)
    unmount()
    expect(paletteRegistry.list().length).toBe(0)
  })

  it('tts-request dispatches custom event when selection present', () => {
    const nav = vi.fn()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    // mock selection
    const origSel = window.getSelection
    Object.defineProperty(window, 'getSelection', {
      configurable: true,
      value: () => ({ toString: () => 'hello world' }),
    })
    try {
      registerVoicesItems(nav)
      const item = paletteRegistry.list().find(i => i.id === 'voice-tts-default')
      item!.action()
      expect(dispatchSpy).toHaveBeenCalled()
      const ttsCall = dispatchSpy.mock.calls.find(c => (c[0] as CustomEvent).type === 'palette:tts-request')
      expect(ttsCall).toBeDefined()
    } finally {
      Object.defineProperty(window, 'getSelection', { configurable: true, value: origSel })
    }
  })
})