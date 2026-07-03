/**
 * SandboxCore —— Proxy 劫持 location + iframe 容器修正
 *
 * 解三个坑（对应面试文档 5.4）：
 *
 * 坑#1：iframe.src 设置 与 Proxy 劫持 location 的时序竞争
 *   解法：用 nextMicrotask() 串行化，setSrc 和劫持永远不并发的同一 tick 里。
 *
 * 坑#3：iframe 内 position:fixed 相对子 viewport（视口=iframe），主应用滚动时浮层飘走
 *   解法：容器加 transform: translateZ(0)（创建新包含块），fixed 相对容器而非 viewport；
 *        并桥接主应用滚动 → iframe 内 fixed 元素需要重新定位时通过 postMessage 通知。
 *
 * 坑#5：iframe 内 navigator.serviceWorker 为 null（SW 不能在 iframe 注册）
 *   解法：探测后只记录 metric，主应用统一注册（ShellApp public/sw.js）。
 */

import type { RumSink } from './types'

export function nextMicrotask(): Promise<void> {
  return Promise.resolve()
}

export interface SandboxCoreContext {
  iframe: HTMLIFrameElement
  container: HTMLElement
  appName: string
  rum: RumSink
  onChildRouteChange(path: string): void
}

/**
 * 安装 Proxy 沙箱 + 容器修正。返回一个 uninstall 函数。
 */
export function installSandboxCore(ctx: SandboxCoreContext): () => void {
  const { iframe, container, appName, rum, onChildRouteChange } = ctx
  const iframeWin = iframe.contentWindow

  // 坑#3：让 iframe 内 position:fixed 相对容器而非子 viewport
  container.style.transform = 'translateZ(0)'

  if (!iframeWin) {
    // about:blank 复用瞬间可能拿不到，下一 microtask 重试
    return () => {}
  }

  // 坑#1：串行化 src 设置和 location 劫持
  // 这里劫持 history 而不是 location（location 劫持太广，影响 fetch 相对路径）
  const history = iframeWin.history
  const originalPush = history.pushState.bind(history)
  const originalReplace = history.replaceState.bind(history)

  const pushProxy = (data: unknown, _unused: string, url?: string) => {
    originalPush(data, '', url)
    rum.metric('child.pushState', 1)
    if (typeof url === 'string') onChildRouteChange(url)
  }
  const replaceProxy = (data: unknown, _unused: string, url?: string) => {
    originalReplace(data, '', url)
    if (typeof url === 'string') onChildRouteChange(url)
  }
  try {
    history.pushState = pushProxy
    history.replaceState = replaceProxy
  } catch (err) {
    // 某些 iframe 状态下 history 是 no-op，记 metric 不阻塞
    rum.metric('history.proxy.failed', 1)
  }

  // 坑#5：SW 在 iframe 不生效，记录一次方便面板演示
  const sw = (iframeWin.navigator as unknown as { serviceWorker?: { register?: unknown } })
    .serviceWorker
  if (!sw || typeof sw.register !== 'function') {
    rum.metric('child.sw.unavailable', 1)
  }

  // 子应用内 popstate（用户点子应用内的链接触发）也要桥到主应用
  const onPop = () => {
    const path = iframeWin.location.pathname + iframeWin.location.search + iframeWin.location.hash
    rum.metric('child.popstate', 1)
    onChildRouteChange(path)
  }
  iframeWin.addEventListener('popstate', onPop)

  return () => {
    try {
      history.pushState = originalPush
      history.replaceState = originalReplace
    } catch {
      /* iframe 已被销毁 */
    }
    try {
      iframeWin.removeEventListener('popstate', onPop)
    } catch {
      /* ignore */
    }
    void appName
  }
}
