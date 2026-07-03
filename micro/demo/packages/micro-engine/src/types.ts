/**
 * 沙箱引擎公共类型
 */

export interface AppManifest {
  /** 唯一名称，用作 LRU key */
  name: string
  /**
   * 子应用入口 HTML（同源 URL，由 ResourceLoader fetch 后注入 iframe）。
   * 与 directUrl 二选一：有 directUrl 时优先走直引模式。
   */
  entryUrl?: string
  /**
   * 跨域直引模式：直接 iframe.src = url（modelscope .ms.show / 任意第三方 Gradio）。
   * 同源策略下不能 fetch+inject，所以 SdkInjector / Proxy history 劫持都跳过。
   * 这是诚实分层：跨域只能拿到 iframe 隔离 + Pool + LRU + Error Boundary，
   * 不能拿到"老代码零改造 SDK 注入"（那是同源专属能力）。
   */
  directUrl?: string
  /** 主路由 path（用于 RouterBridge 双向同步） */
  route: string
  /** 框架标识，影响 hydrate 策略 */
  framework: 'vue2' | 'vue3' | 'react' | 'jquery' | 'native' | 'external'
  /** 加载失败时的 MPA 降级 URL */
  mpaFallbackUrl?: string
  /** 预取的 JS chunk（用于 IdlePrefetch） */
  prefetch?: string[]
  /**
   * 沙箱模式：
   *   - 'iframe-sandbox'（默认）：传统 iframe 沙箱，子应用 DOM 在 iframe 内，content-driven 撑高。
   *     局限：iframe 撑高后自身不滚动 → 虚拟列表依赖父→子 postMessage 桥。
   *   - 'wujie'：iframe 仅作 JS 沙箱（display=none 隐藏），子应用 DOM 通过 document.getElementById
   *     等 API patch 投影到主文档 host 元素。主文档原生滚动 → 虚拟列表 / content-visibility /
   *     footer 全部原生工作。仅同源 entryUrl 应用支持。
   */
  mode?: 'iframe-sandbox' | 'wujie'
}

/**
 * Wujie 模式上下文 —— installWujiePatches 把这些信息透给 iframe 内的 patch 脚本
 */
export interface WujieContext {
  appName: string
  /** 主文档中接收子应用 DOM 的容器元素 */
  hostElement: HTMLElement
  /** 在父 window 上挂 host 的 key（避免多 wujie 应用冲突） */
  hostKey: string
}

export interface SandboxHooks {
  /**
   * HTML 文本被 DOMParser 解析后、注入 iframe 前。
   * 这是 wujie 给不了的能力 —— 用来零改造注入内部 SDK / cookie 填充 / 骨架样式。
   */
  beforeParse?(dom: Document, ctx: ParseContext): void
  /**
   * 注入 iframe 后、子应用 JS 执行前。可绑定 window 代理 / 滚动桥接。
   */
  afterParse?(dom: Document, iframeWindow: Window): void
}

export interface ParseContext {
  appName: string
  user?: unknown
  abConfig?: unknown
  rum: RumSink
  /** 沙箱模式：'wujie' 时 SdkInjector 跳过 height-bridge 脚本（iframe 隐藏，无高度可同步） */
  mode?: 'iframe-sandbox' | 'wujie'
}

export interface RumSink {
  track(event: string, payload?: Record<string, unknown>): void
  metric(name: string, value: number): void
  error(err: Error, meta?: Record<string, unknown>): void
}

export interface SandboxOptions {
  /** 沙箱容器 DOM 选择器或元素 */
  container: string | HTMLElement
  apps: AppManifest[]
  hooks?: SandboxHooks
  /** iframe Pool 预热数量，默认 3 */
  poolSize?: number
  /** keep-alive LRU 上限，默认 5 */
  keepAliveLimit?: number
  /** SDK 注入数据 */
  user?: unknown
  abConfig?: unknown
  /** RUM 上报通道 */
  rum?: RumSink
}

export interface SandboxInstance {
  /** 激活某个子应用（首次 mount 或 keep-alive 复用） */
  activate(appName: string): Promise<void>
  /** 卸载当前并销毁指定 app（从 keep-alive 里清掉） */
  destroy(appName: string): void
  /** 当前激活的 app name */
  current(): string | null
  /** 监听路由同步事件（调试 / 演示用） */
  on(event: SandboxEvent, listener: (payload: unknown) => void): () => void
  /** 释放所有资源 */
  teardown(): void
  /** 调试面板数据 */
  metrics(): SandboxMetrics
}

export type SandboxEvent =
  | 'activate:start'
  | 'activate:success'
  | 'activate:fallback'
  | 'pool:acquire'
  | 'pool:release'
  | 'lru:evict'
  | 'route:sync'
  | 'route:loop-blocked'

export interface SandboxMetrics {
  poolSize: number
  poolPeak: number
  keepAlive: string[]
  current: string | null
  routeSyncCount: number
  routeLoopBlocked: number
  prefetchHits: number
  activateCount: number
  fallbackCount: number
}
