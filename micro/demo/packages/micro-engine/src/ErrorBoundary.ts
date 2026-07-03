/**
 * ErrorBoundary —— 加载失败时降级到 MPA 链路
 *
 * 触发场景：
 *   - HTML 404 / 500
 *   - 网络超时（fetch reject）
 *   - inject 时 iframe document 不可用（极端时序）
 *
 * 降级策略：
 *   默认把当前 iframe location.href 跳到 app.mpaFallbackUrl。
 *   生产场景由 Nginx 路由灰度保证 MPA 链路可用。
 */

import type { AppManifest, RumSink } from './types'

export interface FallbackContext {
  app: AppManifest
  err: Error
  iframe: HTMLIFrameElement
}

export type FallbackHandler = (ctx: FallbackContext) => void

export const defaultFallback: FallbackHandler = ({ app, err, iframe }) => {
  // 没有 fallback url 只记错，不跳转（避免死循环）
  if (!app.mpaFallbackUrl) return
  console.warn(`[ErrorBoundary] ${app.name} failed: ${err.message}; fallback to ${app.mpaFallbackUrl}`)
  try {
    iframe.contentWindow?.location.replace(app.mpaFallbackUrl)
  } catch {
    iframe.src = app.mpaFallbackUrl
  }
}

export class ErrorBoundary {
  private fallbackCount = 0
  constructor(
    private readonly rum: RumSink,
    private readonly handler: FallbackHandler = defaultFallback,
  ) {}

  handle(ctx: FallbackContext): void {
    this.fallbackCount++
    this.rum.error(ctx.err, { appName: ctx.app.name, phase: 'fallback' })
    this.rum.metric('fallback.count', this.fallbackCount)
    try {
      this.handler(ctx)
    } catch (handlerErr) {
      const e = handlerErr instanceof Error ? handlerErr : new Error(String(handlerErr))
      this.rum.error(e, { appName: ctx.app.name, phase: 'fallback.handler' })
    }
  }

  count(): number {
    return this.fallbackCount
  }
}
