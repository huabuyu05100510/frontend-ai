/**
 * RouterBridge —— 主子路由双向同步
 *
 * 坑#4：history.pushState 双向同步会死循环
 *   主→子 pushState → 子 popstate → 子→主 pushState → 主 popstate → 主→子 ...
 *   解法：isSyncing 标志位。进入同步前 true，回调里检查跳过自己的回声。
 *
 * 测试场景：双向连续触发不形成无限循环（loop-blocked 计数应增加）。
 */

import type { RumSink } from './types'

export interface RouterBridgeOptions {
  /** 子应用路由同步过来时，主应用要不要更新自己的 URL */
  onChildRoute(path: string): void
  /** 主应用路由变化时，通知引擎（用于把 hash 同步到子应用） */
  onMainRoute(path: string): void
  rum: RumSink
}

export interface RouterBridgeInstance {
  /** 子应用 iframe 准备好后绑定 popstate 监听 */
  attachChild(iframeWin: Window): void
  /** 主应用入口：监听 popstate / hashchange */
  attachMain(win: Window): void
  /** 主动同步：主 → 子（用户点菜单后） */
  syncToChild(iframeWin: Window, path: string): void
  /** 主动同步：子 → 主（子应用内点链接） */
  syncToMain(win: Window, path: string): void
  detach(): void
}

export function createRouterBridge(opts: RouterBridgeOptions): RouterBridgeInstance {
  // 关键标志位：阻断回环
  let isSyncing = false
  let loopBlockedCount = 0

  const safe = (fn: () => void) => {
    if (isSyncing) {
      loopBlockedCount++
      opts.rum.metric('route.loop-blocked', loopBlockedCount)
      return
    }
    isSyncing = true
    try {
      fn()
    } finally {
      // microtask 释放，保证子应用 popstate 回声也被吞掉
      Promise.resolve().then(() => {
        isSyncing = false
      })
    }
  }

  const attachChild = (iframeWin: Window) => {
    const onChildPop = () => {
      const path =
        iframeWin.location.pathname +
        iframeWin.location.search +
        iframeWin.location.hash
      safe(() => opts.onChildRoute(path))
    }
    iframeWin.addEventListener('popstate', onChildPop)
    iframeWin.addEventListener('hashchange', onChildPop)
  }

  const attachMain = (win: Window) => {
    const onMainPop = () => {
      const path = win.location.pathname + win.location.search + win.location.hash
      safe(() => opts.onMainRoute(path))
    }
    win.addEventListener('popstate', onMainPop)
    win.addEventListener('hashchange', onMainPop)
  }

  const syncToChild = (iframeWin: Window, path: string) => {
    safe(() => {
      try {
        // 用 history.replaceState 避免污染子应用回退栈
        iframeWin.history.replaceState({}, '', path)
      } catch {
        // 跨域 / about:blank 状态下静默失败
      }
    })
  }

  const syncToMain = (win: Window, path: string) => {
    safe(() => {
      try {
        win.history.replaceState({}, '', path)
      } catch {
        /* ignore */
      }
    })
  }

  const detach = () => {
    /* listeners 在 iframe 销毁时随 GC，仅重置标志 */
    isSyncing = false
  }

  return { attachChild, attachMain, syncToChild, syncToMain, detach }
}
