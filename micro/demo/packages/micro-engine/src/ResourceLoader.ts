/**
 * ResourceLoader — HTML 拉取 + beforeParse/afterParse hooks
 *
 * wujie 的 HTML 解析是黑盒，内部 SDK（A+/SSO/AB）无法零改造注入。
 * 这里把 beforeParse 暴露成开放 hook，配合 SdkInjector 实现「老代码零感知」。
 *
 * 边界：
 *   - fetch 404 / 500 → throw，由 ErrorBoundary 接管降级 MPA
 *   - hook 抛错 → 记录 RUM 但不阻塞主流程（注入失败不应让子应用挂掉）
 *   - 同源前提（生产由 Nginx 反代保证）
 */

import type { ParseContext, SandboxHooks } from './types'

export interface LoadResult {
  ok: true
  dom: Document
}

export interface LoadFailure {
  ok: false
  error: Error
  status?: number
}

export class ResourceLoader {
  constructor(
    private readonly hooks: SandboxHooks,
    private readonly onRumError: (err: Error, meta?: Record<string, unknown>) => void,
  ) {}

  async load(url: string, ctx: ParseContext): Promise<LoadResult | LoadFailure> {
    let resp: Response
    try {
      resp = await fetch(url, { credentials: 'include' })
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      this.onRumError(e, { url, phase: 'fetch' })
      return { ok: false, error: e }
    }

    if (!resp.ok) {
      const e = new Error(`load ${url} -> HTTP ${resp.status}`)
      this.onRumError(e, { url, status: resp.status, phase: 'response' })
      return { ok: false, error: e, status: resp.status }
    }

    const html = await resp.text()
    const dom = new DOMParser().parseFromString(html, 'text/html')

    // beforeParse —— SdkInjector / cookie 填充 / 骨架样式 都在这做
    await this.runHook('beforeParse', () => this.hooks.beforeParse?.(dom, ctx), ctx)

    return { ok: true, dom }
  }

  /**
   * 把处理过的 dom.documentElement 写入 iframe document。
   * 注入完成后再 fire afterParse，绑定 Proxy / 滚动桥接。
   */
  inject(iframe: HTMLIFrameElement, dom: Document, ctx: ParseContext): void {
    const iframeDoc = iframe.contentDocument
    const iframeWin = iframe.contentWindow
    if (!iframeDoc || !iframeWin) {
      const e = new Error('iframe document/window unavailable at inject')
      this.onRumError(e, { appName: ctx.appName, phase: 'inject' })
      throw e
    }
    iframeDoc.open()
    iframeDoc.write('<!DOCTYPE html>' + dom.documentElement.outerHTML)
    iframeDoc.close()
    void this.runHook('afterParse', () => this.hooks.afterParse?.(dom, iframeWin), ctx)
  }

  /**
   * hook 抛错不阻塞 —— 老代码注入失败不应让子应用挂掉。
   * 这条铁律来自实战：SDK 加载抖动时不能影响业务渲染。
   */
  private async runHook(
    name: 'beforeParse' | 'afterParse',
    fn: () => void | Promise<void>,
    ctx: ParseContext,
  ): Promise<void> {
    try {
      await fn()
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      ctx.rum.error(e, { phase: name, appName: ctx.appName })
    }
  }
}
