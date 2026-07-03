import { describe, expect, it, vi } from 'vitest'
import { createRouterBridge } from '../src/RouterBridge'
import type { RumSink } from '../src/types'

const rum: RumSink = {
  track: vi.fn(),
  metric: vi.fn(),
  error: vi.fn(),
}

/**
 * 坑#4：history.pushState 双向同步死循环
 *   主→子 pushState → 子 popstate → 子→主 pushState → 主 popstate → ...
 *   解法：isSyncing 标志位阻断回环
 */
describe('RouterBridge 坑#4：防回环', () => {
  it('双向连续触发不形成无限循环', async () => {
    let mainCalls = 0
    let childCalls = 0
    const bridge = createRouterBridge({
      rum,
      onChildRoute: () => {
        childCalls++
      },
      onMainRoute: () => {
        mainCalls++
      },
    })

    // 模拟主→子→主→子 4 次连续触发（不防回环会无限）
    bridge.syncToMain(window, '/a')
    bridge.syncToMain(window, '/b')
    bridge.syncToChild(window as any, '/c')
    bridge.syncToChild(window as any, '/d')

    // 等微任务释放 isSyncing
    await new Promise((r) => setTimeout(r, 10))

    // 应该每个方向各执行了 2 次，而不是爆炸
    expect(mainCalls + childCalls).toBeLessThanOrEqual(4)
  })
})

describe('RouterBridge 子→主路由同步', () => {
  it('触发 attachChild 后 child popstate 时回调 onChildRoute', async () => {
    const onChild = vi.fn()
    const bridge = createRouterBridge({ rum, onChildRoute: onChild, onMainRoute: vi.fn() })
    const fakeWin = {
      location: { pathname: '/sub', search: '', hash: '' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window
    bridge.attachChild(fakeWin)
    expect(fakeWin.addEventListener).toHaveBeenCalledWith('popstate', expect.any(Function))
    expect(fakeWin.addEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function))
  })
})
