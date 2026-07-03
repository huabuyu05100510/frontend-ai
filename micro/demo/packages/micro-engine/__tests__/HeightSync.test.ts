import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSandbox } from '../src/index'
import type { AppManifest, RumSink } from '../src/types'

const rum: RumSink = { track: vi.fn(), metric: vi.fn(), error: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

/**
 * iframe 高度 postMessage 协议（跨域流式布局）测试
 *
 * 协议：子应用通过 parent.postMessage({ type: 'sandbox:height', height: N }, '*') 上报
 * 路由：e.source (contentWindow) → iframeByContentWindow.get → 更新 height
 * 节流：每 iframe 100ms 最多一次
 * 校验：height ∈ [100, 100000] + 整数化
 */
describe('iframe 高度 postMessage 协议（跨域流式布局）', () => {
  /** 模拟子应用上报高度（跨域 message 协议）*/
  function reportHeight(iframe: HTMLIFrameElement, height: number) {
    const childWindow = iframe.contentWindow
    // jsdom 不真正从子 window dispatch 到父 window，需要在父 window 派发并指定 source
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'sandbox:height', height },
        origin: 'https://ext.example.com',
        source: childWindow,
      }),
    )
  }

  it('跨域 directUrl 子应用 postMessage 上报高度，父应用同步 iframe.height', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
        heightStrategy: 'postMessage',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')

    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    expect(iframe).toBeTruthy()
    reportHeight(iframe, 800)
    expect(iframe.style.height).toBe('800px')
  })

  it('节流：100ms 内多次上报只生效一次', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!

    reportHeight(iframe, 500)
    expect(iframe.style.height).toBe('500px')
    // 第二次（100ms 内）应被节流
    reportHeight(iframe, 600)
    expect(iframe.style.height).toBe('500px')
  })

  it('无效 height 拒绝（非数字/负数/过大）', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    const initialHeight = iframe.style.height

    // 字符串
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'sandbox:height', height: 'abc' },
        origin: 'https://ext.example.com',
        source: iframe.contentWindow,
      }),
    )
    expect(iframe.style.height).toBe(initialHeight)
    // 负数
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'sandbox:height', height: -100 },
        origin: 'https://ext.example.com',
        source: iframe.contentWindow,
      }),
    )
    expect(iframe.style.height).toBe(initialHeight)
    // 过大
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'sandbox:height', height: 999999 },
        origin: 'https://ext.example.com',
        source: iframe.contentWindow,
      }),
    )
    expect(iframe.style.height).toBe(initialHeight)
  })

  it('teardown 后停止监听 message', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!

    // 第一次应该生效
    reportHeight(iframe, 500)
    expect(iframe.style.height).toBe('500px')

    sb.teardown()
    // teardown 后 dispatch 不再生效
    reportHeight(iframe, 1000)
    expect(iframe.style.height).not.toBe('1000px')
  })

  it('sandbox policy 默认值（不传时）允许 same-origin + scripts', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    const sandbox = iframe.getAttribute('sandbox') || ''
    expect(sandbox).toContain('allow-same-origin')
    expect(sandbox).toContain('allow-scripts')
  })

  it('sandbox policy 自定义收紧（第三方不可信场景）', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
        sandboxPolicy: 'allow-same-origin',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    const sandbox = iframe.getAttribute('sandbox') || ''
    expect(sandbox).toBe('allow-same-origin')
    expect(sandbox).not.toContain('allow-scripts')
  })

  it('height:sync 事件正确派发（含 appName）', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext-app',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    const handler = vi.fn()
    sb.on('height:sync', handler)
    await sb.activate('ext-app')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    reportHeight(iframe, 600)
    expect(handler).toHaveBeenCalledWith({ appName: 'ext-app', height: 600 })
  })

  it('非 sandbox:height 类型的 message 忽略', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    const initialHeight = iframe.style.height

    // 错误 type
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'something-else', height: 999 },
        origin: 'https://ext.example.com',
        source: iframe.contentWindow,
      }),
    )
    expect(iframe.style.height).toBe(initialHeight)
    // 完全无关的 message
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { foo: 'bar' },
        origin: 'https://ext.example.com',
        source: iframe.contentWindow,
      }),
    )
    expect(iframe.style.height).toBe(initialHeight)
  })

  it('height 取整：899.7 → 900', async () => {
    document.body.innerHTML = '<div id="sandbox"></div>'
    const apps: AppManifest[] = [
      {
        name: 'ext',
        route: '/ext',
        framework: 'external',
        directUrl: 'https://ext.example.com/',
      },
    ]
    const sb = createSandbox({ container: '#sandbox', poolSize: 1, apps, rum })
    await sb.activate('ext')
    const iframe = document.querySelector<HTMLIFrameElement>('iframe')!
    reportHeight(iframe, 899.7)
    expect(iframe.style.height).toBe('900px')
  })
})
