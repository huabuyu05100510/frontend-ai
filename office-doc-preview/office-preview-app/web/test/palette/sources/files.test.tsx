// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRegisterFilesItems, registerFilesItems } from '../../../src/palette/sources/files'
import { paletteRegistry } from '../../../src/palette/registry'
import { useStore } from '../../../src/store'

const initialState = useStore.getState()

describe('files source', () => {
  beforeEach(() => {
    paletteRegistry.clear()
    // reset store tasks
    useStore.setState({ tasks: [] }, false)
  })

  it('imperative register creates one item per task', () => {
    const nav = vi.fn()
    registerFilesItems(nav, [
      { id: 't1', name: 'contract.pdf' },
      { id: 't2', name: 'report.docx' },
    ])
    const items = paletteRegistry.list()
    expect(items.length).toBe(2)
    expect(items[0].group).toBe('文件')
    expect(items[0].id).toBe('file-t1')
  })

  it('action callback navigates to /files?task=<id>', () => {
    const nav = vi.fn()
    registerFilesItems(nav, [{ id: 't_xyz', name: 'a.pdf' }])
    const item = paletteRegistry.list()[0]
    item.action()
    expect(nav).toHaveBeenCalledWith('/files?task=t_xyz')
  })

  it('hook registers items; unmount unregisters them', () => {
    useStore.setState({
      tasks: [
        { id: 't1', name: 'a.pdf' } as any,
        { id: 't2', name: 'b.pdf' } as any,
      ],
    }, false)
    const { unmount } = renderHook(() => useRegisterFilesItems(), { wrapper: MemoryRouter })
    expect(paletteRegistry.list().length).toBe(2)
    unmount()
    expect(paletteRegistry.list().length).toBe(0)
  })

  it('caps tasks at MAX_TASKS=20', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: `f${i}.pdf` }))
    registerFilesItems(() => {}, tasks)
    expect(paletteRegistry.list().length).toBe(20)
  })
})