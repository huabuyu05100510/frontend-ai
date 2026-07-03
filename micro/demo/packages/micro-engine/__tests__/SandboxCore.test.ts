import { describe, expect, it, vi } from 'vitest'
import { nextMicrotask } from '../src/SandboxCore'
import { injectSdk } from '../src/SdkInjector'
import type { ParseContext, RumSink } from '../src/types'

const rum: RumSink = { track: vi.fn(), metric: vi.fn(), error: vi.fn() }
const ctx: ParseContext = { appName: 'app', rum, user: { id: 'u1', name: 'alice' }, abConfig: { exp: 'A' } }

describe('SandboxCore / SdkInjector 边界场景', () => {
  it('nextMicrotask 返回的 promise 在下一个微任务执行', async () => {
    let ran = false
    nextMicrotask().then(() => (ran = true))
    expect(ran).toBe(false)
    await Promise.resolve()
    expect(ran).toBe(true)
  })

  it('SdkInjector 注入 __USER__ / __AB__ / RUM 桥', () => {
    const dom = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html')
    injectSdk(dom, ctx)
    // head 应该至少多了 3 段 script（rum 桥、A+、数据）
    const scripts = dom.head.querySelectorAll('script')
    expect(scripts.length).toBeGreaterThanOrEqual(3)
    // 数据 script 里有 __USER__ 内容
    const dataText = Array.from(scripts).map((s) => s.textContent || '').join('\n')
    expect(dataText).toMatch(/__USER__/)
    expect(dataText).toMatch(/alice/)
    expect(dataText).toMatch(/__AB__/)
  })

  it('SdkInjector 注入 top 代理（坑#2 解法）', () => {
    const dom = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html')
    injectSdk(dom, ctx)
    const rumScript = dom.head.querySelector('script')!.textContent || ''
    // 必须把 window.top 重定向到 window.parent，老代码 top.postMessage 才不报跨域错
    expect(rumScript).toMatch(/defineProperty\(window,\s*['"]top['"]/)
  })

  it('SdkInjector 注入 data-track 自动埋点监听', () => {
    const dom = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html')
    injectSdk(dom, ctx)
    const rumScript = dom.head.querySelector('script')!.textContent || ''
    expect(rumScript).toMatch(/closest\(['"]?\[data-track\]/)
    expect(rumScript).toMatch(/__RUM__\.track/)
  })

  it('injectSdk 不抛错（即使 head 缺失也不挂）', () => {
    // 极端构造：head 不存在的 doc
    const dom = { head: null } as unknown as Document
    expect(() => injectSdk(dom, ctx)).not.toThrow()
  })
})
