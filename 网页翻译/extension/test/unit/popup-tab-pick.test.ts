import { describe, it, expect } from 'vitest'
import { pickTargetTab } from '../../src/popup/App'

describe('pickTargetTab — 从 popup 路由消息到用户页面', () => {
  it('典型场景：popup + example.com 同时存在', () => {
    const tabs = [
      { id: 1, url: 'https://example.com/', active: false },
      { id: 2, url: 'chrome-extension://abc/src/popup/popup.html', active: true },
    ]
    expect(pickTargetTab(tabs as any, 2)?.id).toBe(1)
  })

  it('⚠ 关键 case：popup 自己 active + lastFocused 仍不能拿到自己', () => {
    const tabs = [
      { id: 100, url: 'chrome-extension://abc/src/popup/popup.html', active: true },
      { id: 200, url: 'https://news.ycombinator.com/', active: false },
    ]
    expect(pickTargetTab(tabs as any, 100)?.id).toBe(200)
  })

  it('chrome:// 页面被排除', () => {
    const tabs = [
      { id: 1, url: 'chrome://settings/', active: true },
      { id: 2, url: 'https://example.com/', active: false },
    ]
    expect(pickTargetTab(tabs as any, 3)?.id).toBe(2)
  })

  it('about: 页面被排除', () => {
    const tabs = [
      { id: 1, url: 'about:blank', active: true },
      { id: 2, url: 'https://example.com/', active: false },
    ]
    expect(pickTargetTab(tabs as any, 3)?.id).toBe(2)
  })

  it('优先选 active + 可用的页面（用户在浏览的那个）', () => {
    const tabs = [
      { id: 1, url: 'https://example.com/', active: false },
      { id: 2, url: 'https://github.com/', active: true },
    ]
    expect(pickTargetTab(tabs as any, 99)?.id).toBe(2)
  })

  it('没有任何普通页 → 返回 undefined（不挑扩展页）', () => {
    const tabs = [
      { id: 1, url: 'chrome-extension://abc/popup.html', active: true },
      { id: 2, url: 'chrome://settings/', active: false },
    ]
    expect(pickTargetTab(tabs as any, 1)).toBeUndefined()
  })

  it('多个普通页 + 用户切到非 active 的那个 → 兜底选第一个', () => {
    const tabs = [
      { id: 1, url: 'https://example.com/', active: false },
      { id: 2, url: 'https://github.com/', active: false },
    ]
    expect(pickTargetTab(tabs as any, 99)?.id).toBe(1)
  })

  it('无 url 的 tab 跳过（activeTab 权限下未授权页面无 url）', () => {
    const tabs = [
      { id: 1, active: true }, // 无 url → 跳过
      { id: 2, url: 'https://example.com/', active: false },
    ]
    expect(pickTargetTab(tabs as any, 99)?.id).toBe(2)
  })
})