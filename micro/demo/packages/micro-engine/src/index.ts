/**
 * micro-engine — 自研沙箱引擎入口
 *
 * 12KB 内做的事：
 *   - iframe Pool（启动 80ms → <20ms）
 *   - ResourceLoader（beforeParse/afterParse hooks —— wujie 黑盒外的开放能力）
 *   - SdkInjector（老代码零改造注入 A+/SSO/AB/埋点 + top 代理）
 *   - SandboxCore（history 劫持 + 容器修正 + SW 探测）
 *   - RouterBridge（主子双向同步 + isSyncing 防回环）
 *   - LifecycleManager（LRU keep-alive 上限 5）
 *   - ErrorBoundary（失败自动跳 MPA）
 *   - IdlePrefetch（requestIdleCallback 预取 entry/SSG）
 */

import { ErrorBoundary } from './ErrorBoundary'
import { IdlePrefetch } from './IdlePrefetch'
import { IframePool } from './IframePool'
import { LifecycleManager } from './LifecycleManager'
import { ResourceLoader } from './ResourceLoader'
import { injectSdk } from './SdkInjector'
import { createRouterBridge } from './RouterBridge'
import { Scheduler } from './Scheduler'
import { installSandboxCore, nextMicrotask } from './SandboxCore'
import {
  createHostElement,
  installWujiePatches,
  uninstallWujiePatches,
} from './WujieSandbox'
import type {
  AppManifest,
  ParseContext,
  RumSink,
  SandboxEvent,
  SandboxHooks,
  SandboxInstance,
  SandboxMetrics,
  SandboxOptions,
  WujieContext,
} from './types'

export function createSandbox(options: SandboxOptions): SandboxInstance {
  const container =
    typeof options.container === 'string'
      ? document.querySelector<HTMLElement>(options.container)!
      : options.container

  if (!container) throw new Error('createSandbox: container not found')

  const rum: RumSink =
    options.rum ?? {
      track: (e, p) => listeners.dispatch('rum:track', { event: e, payload: p }),
      metric: (n, v) => listeners.dispatch('rum:metric', { name: n, value: v }),
      error: (err, meta) => listeners.dispatch('rum:error', { err, meta }),
    }

  const hooks: SandboxHooks = options.hooks ?? {}
  const pool = new IframePool(options.poolSize ?? 3)
  const lifecycle = new LifecycleManager(options.keepAliveLimit ?? 5, {
    onEvict: (entry) => {
      pool.release(entry.iframe)
      listeners.dispatch('lru:evict', { appName: entry.appName })
    },
  })
  const loader = new ResourceLoader(hooks, rum.error.bind(rum))
  const boundary = new ErrorBoundary(rum)
  const scheduler = new Scheduler()
  const prefetch = new IdlePrefetch(scheduler)
  const apps = new Map(options.apps.map((a) => [a.name, a]))

  const listeners = createListenerBus<string>()
  let routeSyncCount = 0
  let routeLoopBlocked = 0
  let activateCount = 0

  // ModelScope 风格：postMessage 协议 + WeakMap<contentWindow, iframe> 反查
  // 子应用 producer 端（由 SdkInjector 注入 __SANDBOX__.reportHeight）调用
  // parent.postMessage({type:'sandbox:height', height}) → 这里查回 iframe 设高
  const winToIframe = new WeakMap<WindowProxy, HTMLIFrameElement>()
  // 每个 iframe 的上次上报值，过滤抖动（Math.ceil + 1px 阈值）
  const lastReport = new WeakMap<HTMLIFrameElement, number>()
  // RAF + 100ms 节流：高频 resize 合并到一帧
  const pendingRaf = new WeakMap<HTMLIFrameElement, number>()
  const lastReportTime = new WeakMap<HTMLIFrameElement, number>()

  function handleMessage(ev: MessageEvent) {
    const data = ev.data
    if (!data || typeof data !== 'object') return
    if (data.type !== 'sandbox:height') return
    if (typeof data.height !== 'number' || !isFinite(data.height) || data.height <= 0) return
    const iframe = winToIframe.get(ev.source as WindowProxy)
    if (!iframe) return

    const target = iframe
    const h = Math.ceil(data.height)
    // 抖动过滤：与上次差 ≤1px 不更新（避免 sub-pixel 抖动触发 reflow）
    const last = lastReport.get(target) ?? -1
    if (Math.abs(h - last) <= 1) return

    const now = Date.now()
    const lastT = lastReportTime.get(target) ?? 0
    // 节流：100ms 内的多次上报合并，用 RAF 兜底保证渲染前生效
    if (now - lastT < 100) {
      if (!pendingRaf.has(target)) {
        pendingRaf.set(
          target,
          requestAnimationFrame(() => {
            pendingRaf.delete(target)
            applyHeight(target, h)
          }),
        )
      }
      return
    }
    applyHeight(target, h)
  }
  function applyHeight(iframe: HTMLIFrameElement, h: number) {
    iframe.style.height = h + 'px'
    iframe.style.minHeight = ''  // 撤掉兜底，让 iframe 收缩到内容
    lastReport.set(iframe, h)
    lastReportTime.set(iframe, Date.now())
    const cur = lifecycle.current()
    const appName = cur && (lifecycle as any).alive.get(cur)?.iframe === iframe ? cur : null
    listeners.dispatch('height:sync', { appName, height: h })
  }
  window.addEventListener('message', handleMessage)

  // RouterBridge：主子双向同步
  const router = createRouterBridge({
    rum,
    onChildRoute: (path) => {
      routeSyncCount++
      listeners.dispatch('route:sync', { direction: 'child->main', path })
      // 子 → 主：同步到主应用 URL（保持地址栏一致）
      try {
        history.replaceState({}, '', path)
      } catch {
        /* ignore */
      }
    },
    onMainRoute: (path) => {
      routeSyncCount++
      listeners.dispatch('route:sync', { direction: 'main->child', path })
      // 主 → 子：当前激活的 iframe 跟着切
      const cur = lifecycle.current()
      if (cur) {
        const entry = (lifecycle as any).alive.get(cur) as { iframe: HTMLIFrameElement } | undefined
        if (entry?.iframe?.contentWindow) router.syncToChild(entry.iframe.contentWindow, path)
      }
    },
  })
  router.attachMain(window)

  // 预热池 + 启动 idle prefetch（同源 entryUrl 才预取，跨域 directUrl 不预取会被 CORS 挡）
  pool.warmup(container)
  const prefetchUrls = options.apps.flatMap((a) =>
    a.directUrl ? [] : [a.entryUrl, ...(a.prefetch ?? [])].filter(Boolean) as string[],
  )
  if (prefetchUrls.length) prefetch.prefetch(prefetchUrls)

  async function activate(appName: string): Promise<void> {
    const app = apps.get(appName)
    if (!app) throw new Error(`unknown app: ${appName}`)
    activateCount++
    listeners.dispatch('activate:start', { appName })

    // 1. keep-alive 命中：直接显示，~0ms
    if (lifecycle.has(appName)) {
      // 取已存在的 iframe（不重新 mount）。lifecycle.mount 会把 LRU 提到末位
      const existing = (lifecycle as any).alive.get(appName)?.iframe as HTMLIFrameElement | undefined
      if (existing) {
        lifecycle.mount(appName, existing)
        listeners.dispatch('activate:success', { appName, reused: true })
        rum.metric('activate.reused', 1)
        return
      }
    }

    // 2. 首次激活：acquire iframe + fetch HTML + inject（或 directUrl 直引）
    const iframe = pool.acquire(container)
    iframe.style.display = 'block'
    iframe.style.visibility = 'visible'
    iframe.style.left = '0'
    // 注册到 WeakMap，postMessage 高度上报时反查 iframe
    if (iframe.contentWindow) winToIframe.set(iframe.contentWindow, iframe)
    listeners.dispatch('pool:acquire', {
      fromPool: pool.metrics().totalReused > 0,
      poolSize: pool.metrics().size,
    })

    // 坑#1：串行化 iframe.src 与 sandbox core 安装，避免 microtask 竞争
    await nextMicrotask()

    // ─── URL 直引模式（跨域，modelscope .ms.show / 任意第三方 Gradio）───
    // 跳过 fetch+inject、SdkInjector、Proxy history 劫持。
    // 同源策略下做不到这些；保留的能力：iframe 隔离 / Pool / LRU / Error Boundary / load 事件
    if (app.directUrl) {
      iframe.setAttribute('aria-hidden', 'false')
      iframe.src = app.directUrl
      // 监听 load/error 用于 metrics & fallback
      const onLoad = () => {
        iframe.removeEventListener('load', onLoad)
        iframe.removeEventListener('error', onErr)
        rum.metric('direct.load', 1)
      }
      const onErr = (e: Event) => {
        iframe.removeEventListener('load', onLoad)
        iframe.removeEventListener('error', onErr)
        const err = new Error(`directUrl load failed: ${app.directUrl}`)
        boundary.handle({ app, err, iframe })
        listeners.dispatch('activate:fallback', { appName, error: err.message })
      }
      iframe.addEventListener('load', onLoad)
      iframe.addEventListener('error', onErr)
      // 跨域 history 不可劫持，但走 lifecycle.mount 仍享受 Pool / LRU / 显隐切换
      lifecycle.mount(appName, iframe)
      listeners.dispatch('activate:success', { appName, reused: false, mode: 'direct' })
      rum.metric('activate.first', 1)
      return
    }

    if (!app.entryUrl) {
      const err = new Error(`manifest for ${appName} missing both entryUrl and directUrl`)
      boundary.handle({ app, err, iframe })
      return
    }

    const ctx: ParseContext = {
      appName,
      user: options.user,
      abConfig: options.abConfig,
      rum,
      mode: app.mode ?? 'iframe-sandbox',
    }

    const result = await loader.load(app.entryUrl, ctx)
    if (!result.ok) {
      boundary.handle({ app, err: result.error, iframe })
      listeners.dispatch('activate:fallback', { appName, error: result.error.message })
      return
    }

    // Wujie 模式：创建主文档 host + 注入 patch 脚本（先于 SdkInjector，先于子应用脚本）
    let wujieCtx: WujieContext | null = null
    if (ctx.mode === 'wujie') {
      const host = createHostElement({ appName, container })
      wujieCtx = {
        appName,
        hostElement: host,
        hostKey: `__WUJIE_HOST__${appName}`,
      }
      // 在父 window 上挂 host 引用，patch 脚本通过 parent[hostKey] 取
      ;(window as unknown as Record<string, unknown>)[wujieCtx.hostKey] = host
      try {
        installWujiePatches(result.dom, wujieCtx)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        rum.error(e, { phase: 'installWujiePatches', appName })
      }
    }

    // SdkInjector 默认走 beforeParse hook（如果调用方没自定义）
    try {
      injectSdk(result.dom, ctx)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      rum.error(e, { phase: 'injectSdk', appName })
    }

    loader.inject(iframe, result.dom, ctx)

    // Wujie 模式：iframe 隐藏（保留 rAF，不暂停脚本；display:none 会暂停 rAF）
    if (ctx.mode === 'wujie') {
      Object.assign(iframe.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        overflow: 'hidden',
      })
    }

    // SandboxCore：history 劫持 + 容器修正（仅同源）
    const detachCore = installSandboxCore({
      iframe,
      container,
      appName,
      rum,
      onChildRouteChange: (path) => {
        routeSyncCount++
        listeners.dispatch('route:sync', { direction: 'child->main', path })
      },
    })
    // RouterBridge 绑定子应用
    if (iframe.contentWindow) router.attachChild(iframe.contentWindow)

    // lifecycle.mount 会 hide 旧的、显示新的
    lifecycle.mount(appName, iframe)

    // 把卸载回调挂到 entry 上（用闭包持有 detachCore + wujie host 清理）
    ;(lifecycle as any).alive.get(appName).__detach = () => {
      detachCore()
      if (wujieCtx) {
        try { uninstallWujiePatches(wujieCtx) } catch (_) {}
      }
    }

    listeners.dispatch('activate:success', { appName, reused: false })
    rum.metric('activate.first', 1)
  }

  function destroy(appName: string): void {
    const entry = (lifecycle as any).alive.get(appName)
    entry?.__detach?.()
    lifecycle.destroy(appName)
  }

  function teardown(): void {
    prefetch.cancel()
    lifecycle.clear()
    pool.drain()
    router.detach()
    window.removeEventListener('message', handleMessage)
  }

  function metrics(): SandboxMetrics {
    const pm = pool.metrics()
    return {
      poolSize: pm.size,
      poolPeak: pm.peak,
      keepAlive: lifecycle.list(),
      current: lifecycle.current(),
      routeSyncCount,
      routeLoopBlocked,
      prefetchHits: prefetch.stats().hits,
      activateCount,
      fallbackCount: boundary.count(),
    }
  }

  return {
    activate,
    destroy,
    current: () => lifecycle.current(),
    on: (event, listener) => listeners.on(event, listener),
    teardown,
    metrics,
  }
}

/** 极简事件总线（避免引第三方） */
function createListenerBus<T extends string>() {
  const map = new Map<T, Set<(payload: unknown) => void>>()
  return {
    on(event: T, listener: (payload: unknown) => void): () => void {
      let set = map.get(event)
      if (!set) {
        set = new Set()
        map.set(event, set)
      }
      set.add(listener)
      return () => set!.delete(listener)
    },
    dispatch(event: T, payload: unknown): void {
      map.get(event)?.forEach((fn) => {
        try {
          fn(payload)
        } catch {
          /* 单 listener 抛错不影响其他 */
        }
      })
    },
  }
}

export type { AppManifest, SandboxOptions, SandboxInstance, SandboxHooks, SandboxEvent, SandboxMetrics, RumSink } from './types'
