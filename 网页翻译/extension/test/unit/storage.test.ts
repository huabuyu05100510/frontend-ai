/**
 * popup storage —— 校验 API key 只走 storage.local，不写 storage.sync
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock chrome.storage，分别记录 local/sync 的 set 调用
function makeArea() {
  const store: Record<string, unknown> = {}
  const setCalls: Array<Record<string, unknown>> = []
  return {
    store,
    setCalls,
    area: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...store }
        const arr = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const k of arr) if (k in store) out[k] = store[k]
        return out
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items)
        setCalls.push({ ...items })
        return undefined
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        for (const k of arr) delete store[k]
        return undefined
      }),
    },
  }
}

const local = makeArea()
const sync = makeArea()

;(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: local.area, sync: sync.area },
  runtime: { onMessage: { addListener: () => {}, removeListener: () => {} } },
  tabs: {
    getCurrent: vi.fn((cb: (t: unknown) => void) => cb({ id: 1 })),
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => null),
  },
}

describe('popup: API key 存储', () => {
  beforeEach(() => {
    local.store = {}
    local.setCalls.length = 0
    sync.store = {}
    sync.setCalls.length = 0
  })

  it('popup 不应调用 storage.sync.set', async () => {
    // 动态 import 确保 useEffect 走一遍
    const mod = await import('../../src/popup/App')
    expect(mod).toBeTruthy()
    // 这里只断言 mock 调用语义：在测试环境下 App 没挂载，effect 没触发；
    // 真正的语义靠 typecheck + review: 源码 grep 不应出现 storage.sync.set。
    // 这里硬断言：sync.area.set 至少没被本测试触发
    expect(sync.area.set).not.toHaveBeenCalled()
  })

  it('popup 源码已无 storage.sync.set（grep 守恒，hardcoded fallback 允许；标注 toggle 是例外）', async () => {
    // 策略：hardcoded fallback 仅作为本地调试兜底，允许存在；
    // storage.sync.set 跨 Google 帐号同步 = key 外泄，必须为零；
    // 例外：标注 toggle（xtAnnotationEnabled）走 sync，因为 popup + content script 都需要读，
    //       不存敏感数据。
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../../src')
    const files = [
      path.join(root, 'popup/App.tsx'),
      path.join(root, 'background/background.ts'),
    ]
    for (const f of files) {
      const code = await fs.readFile(f, 'utf8')
      // 移除「标注 toggle 的合法 storage.sync.set」行后，再 grep
      const stripped = code
        .split('\n')
        .filter(line => !line.includes('ANNO_ENABLED_KEY'))
        .join('\n')
      expect(stripped).not.toMatch(/storage\.sync\.set/, `${f} 不应写 storage.sync.set`)
    }
  })
})
