import { describe, expect, it, vi } from 'vitest'
import { LifecycleManager } from '../src/LifecycleManager'

function fakeIframe(name: string): HTMLIFrameElement {
  const el = { style: {}, dataset: { name } } as unknown as HTMLIFrameElement
  return el
}

describe('LifecycleManager LRU 淘汰', () => {
  it('激活第 6 个 app 时，第 1 个被淘汰', () => {
    const onEvict = vi.fn()
    const mgr = new LifecycleManager(5, { onEvict })
    for (let i = 0; i < 6; i++) {
      mgr.mount(`app-${i}`, fakeIframe(`i-${i}`))
    }
    expect(mgr.list()).toEqual(['app-1', 'app-2', 'app-3', 'app-4', 'app-5'])
    expect(onEvict).toHaveBeenCalledTimes(1)
    expect(onEvict.mock.calls[0][0].appName).toBe('app-0')
  })

  it('命中已激活的 app 提到末位（最近用过）', () => {
    const mgr = new LifecycleManager(3)
    mgr.mount('a', fakeIframe('a'))
    mgr.mount('b', fakeIframe('b'))
    mgr.mount('c', fakeIframe('c'))
    // 重新激活 a → 应排到末位
    mgr.mount('a', fakeIframe('a'))
    expect(mgr.list()).toEqual(['b', 'c', 'a'])
    // 再激活新 app d → 淘汰 b（最久未用）
    const onEvict = vi.fn()
    ;(mgr as any).cb.onEvict = onEvict
    mgr.mount('d', fakeIframe('d'))
    expect(mgr.list()).toEqual(['c', 'a', 'd'])
    expect(onEvict.mock.calls[0][0].appName).toBe('b')
  })

  it('current() 反映最近激活的 app', () => {
    const mgr = new LifecycleManager(5)
    expect(mgr.current()).toBeNull()
    mgr.mount('a', fakeIframe('a'))
    expect(mgr.current()).toBe('a')
    mgr.mount('b', fakeIframe('b'))
    expect(mgr.current()).toBe('b')
  })

  it('destroy 销毁指定 app 并清 current', () => {
    const onEvict = vi.fn()
    const mgr = new LifecycleManager(5, { onEvict })
    mgr.mount('a', fakeIframe('a'))
    mgr.destroy('a')
    expect(mgr.list()).toEqual([])
    expect(mgr.current()).toBeNull()
    expect(onEvict).toHaveBeenCalledTimes(1)
  })
})
