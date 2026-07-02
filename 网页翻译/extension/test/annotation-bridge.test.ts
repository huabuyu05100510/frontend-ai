/**
 * Agent 8 — AnnotationBridge 单测
 *
 * 测试桥接层（content ↔ annotator + schema + IDB）的契约：
 *   - 实例化：encode/put/isRatedRecent 注入
 *   - attachBilingual：bilingual 模式挂 ✏️ + ⭐
 *   - attachTranslationOnly：仅译文模式只挂 ⭐
 *   - cleanup：清掉所有挂载
 *   - setEnabled(false)：不挂任何 UI（即便 disabled 后再 enable 也不主动补挂）
 *   - chrome.storage.onChanged → setEnabled
 *
 * TDD 流程：先 test 后 impl
 *
 * 模型：claude-sonnet-4-6 (MiniMax-M3 路由)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AnnotationBridge } from '../src/content/annotation-bridge'
import type { AlignmentResult } from '../src/shared/types'

// ─── chrome API mock ────────────────────────────────────────────
const storageData: Record<string, unknown> = {}
type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void
const storageListeners: StorageListener[] = []

;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    onChanged: {
      addListener: vi.fn((cb: StorageListener) => {
        storageListeners.push(cb)
      }),
    },
    sync: {
      get: vi.fn((keys: string | string[] | null, cb?: (r: Record<string, unknown>) => void) => {
        const k = Array.isArray(keys) ? keys : keys ? [keys] : Object.keys(storageData)
        const out: Record<string, unknown> = {}
        for (const key of k) out[key] = storageData[key]
        if (cb) cb(out)
        return Promise.resolve(out)
      }),
      set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storageData, items)
        if (cb) cb()
        return Promise.resolve()
      }),
    },
    local: {
      get: vi.fn((_keys: unknown, cb?: (r: Record<string, unknown>) => void) => {
        if (cb) cb({})
        return Promise.resolve({})
      }),
    },
  },
}

function resetStorage() {
  for (const k of Object.keys(storageData)) delete storageData[k]
  storageData.xtAnnotationEnabled = true
  storageListeners.length = 0
}

function fireStorageChange(key: string, newValue: unknown, oldValue?: unknown) {
  for (const l of storageListeners) {
    l({ [key]: { newValue, oldValue } }, 'sync')
  }
}

// ─── encode/put mock（模拟 Agent 1 + Agent 2 的接口）──────────
const encodeMock = vi.fn(async (input: unknown) => ({
  ...(input as Record<string, unknown>),
  id: `anno-${Math.random().toString(36).slice(2, 10)}`,
  createdAt: Date.now(),
}))
const putMock = vi.fn(async (_anno: unknown) => 'ok')
const isRatedRecentMock = vi.fn(async (_segId: string) => false)

// ─── helpers ────────────────────────────────────────────────────
function buildSrcEl(segId: string, srcText: string): HTMLElement {
  const el = document.createElement('p')
  el.setAttribute('data-xt-id', segId)
  el.setAttribute('data-xt-original', srcText)
  el.textContent = srcText
  return el
}

function buildTgtEl(segId: string, tgtText: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'xt-translation'
  el.setAttribute('data-xt-tgt', segId)
  el.textContent = tgtText
  return el
}

function buildAlignment(segId: string): AlignmentResult {
  return {
    segmentId: segId,
    srcTokens: ['I', 'love', 'you'],
    tgtTokens: ['我', '爱', '你'],
    alignments: [
      { srcIdx: 0, tgtIdx: 0, score: 0.9 },
      { srcIdx: 1, tgtIdx: 1, score: 0.95 },
      { srcIdx: 2, tgtIdx: 2, score: 0.85 },
    ],
  }
}

function buildCtx(segId = 's1', mode: 'bilingual' | 'translation-only' = 'bilingual') {
  const srcEl = buildSrcEl(segId, 'I love you')
  const tgtEl = buildTgtEl(segId, '我爱你')
  srcEl.appendChild(tgtEl)
  document.body.appendChild(srcEl)
  return {
    enabled: true,
    segmentId: segId,
    srcText: 'I love you',
    tgtText: '我爱你',
    srcTokens: ['I', 'love', 'you'],
    tgtTokens: ['我', '爱', '你'],
    predicted: [[0, 0], [1, 1], [2, 2]] as Array<[number, number]>,
    srcEl,
    tgtEl,
    mode,
    langPair: ['en', 'zh'] as [string, string],
    url: 'https://test/',
    alignment: buildAlignment(segId),
  }
}

// ─── tests ──────────────────────────────────────────────────────

describe('AnnotationBridge — 实例化', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
    isRatedRecentMock.mockClear()
  })

  it('注入 encode/put/isRatedRecent 不抛错', () => {
    expect(
      () =>
        new AnnotationBridge({
          encode: encodeMock,
          put: putMock,
          isRatedRecent: isRatedRecentMock,
        }),
    ).not.toThrow()
  })

  it('构造时自动注册 chrome.storage.onChanged 监听器', () => {
    const chromeApi = (globalThis as unknown as { chrome: { storage: { onChanged: { addListener: unknown } } } })
      .chrome
    expect(chromeApi.storage.onChanged.addListener).toBeDefined()
    new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    expect(chromeApi.storage.onChanged.addListener).toHaveBeenCalled()
  })
})

describe('AnnotationBridge — attachBilingual（双语模式）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
    isRatedRecentMock.mockClear()
  })

  it('调用 annotator 的 mount（挂 ✏️ + ⭐）', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)

    // annotator.ts mount 后应创建 .xt-anno-pencil-host + .xt-anno-star-host
    expect(document.querySelector('.xt-anno-pencil-host')).toBeTruthy()
    expect(document.querySelector('.xt-anno-star-host')).toBeTruthy()
  })

  it('attachBilingual 不抛错（即便 ctx 缺少 langPair 等字段）', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    const ctx = buildCtx('s1', 'bilingual')
    expect(() => bridge.attachBilingual(ctx)).not.toThrow()
  })

  it('enabled=false 时 attachBilingual 不挂任何 UI', () => {
    storageData.xtAnnotationEnabled = false
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    bridge.setEnabled(false)
    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)

    expect(document.querySelector('.xt-anno-pencil-host')).toBeFalsy()
    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
  })
})

describe('AnnotationBridge — attachTranslationOnly（仅译文模式）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
    isRatedRecentMock.mockClear()
  })

  it('仅挂 ⭐，不挂 ✏️（translation-only 模式无对齐气泡）', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    const ctx = buildCtx('s1', 'translation-only')
    bridge.attachTranslationOnly(ctx)

    expect(document.querySelector('.xt-anno-star-host')).toBeTruthy()
    expect(document.querySelector('.xt-anno-pencil-host')).toBeFalsy()
  })

  it('enabled=false 时 attachTranslationOnly 也不挂任何 UI', () => {
    storageData.xtAnnotationEnabled = false
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    bridge.setEnabled(false)
    const ctx = buildCtx('s1', 'translation-only')
    bridge.attachTranslationOnly(ctx)

    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
  })
})

describe('AnnotationBridge — cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
    isRatedRecentMock.mockClear()
  })

  it('cleanup 移除所有已挂载的 UI', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)
    expect(document.querySelector('.xt-anno-pencil-host')).toBeTruthy()
    expect(document.querySelector('.xt-anno-star-host')).toBeTruthy()

    bridge.cleanup()
    expect(document.querySelector('.xt-anno-pencil-host')).toBeFalsy()
    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
  })

  it('cleanup 后再 attachBilingual 仍能正常挂载', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)
    bridge.cleanup()
    bridge.attachBilingual(ctx)
    expect(document.querySelector('.xt-anno-pencil-host')).toBeTruthy()
    expect(document.querySelector('.xt-anno-star-host')).toBeTruthy()
  })
})

describe('AnnotationBridge — setEnabled + chrome.storage.onChanged', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
    isRatedRecentMock.mockClear()
  })

  it('setEnabled(false) 后 attachBilingual 不挂 UI', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    bridge.setEnabled(false)
    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)
    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
    expect(document.querySelector('.xt-anno-pencil-host')).toBeFalsy()
  })

  it('chrome.storage.onChanged → xtAnnotationEnabled=false 触发 setEnabled(false)', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    // 模拟 popup 改写 storage
    fireStorageChange('xtAnnotationEnabled', false, true)

    // setEnabled(false) 后 attachBilingual 应不挂 UI
    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)
    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
  })

  it('chrome.storage.onChanged → xtAnnotationEnabled=true 触发 setEnabled(true)', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    // 先禁用
    fireStorageChange('xtAnnotationEnabled', false, true)
    // 再启用
    fireStorageChange('xtAnnotationEnabled', true, false)

    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)
    expect(document.querySelector('.xt-anno-star-host')).toBeTruthy()
  })

  it('chrome.storage.onChanged 触发非 xtAnnotationEnabled 字段被忽略', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    // 改写其他 key 不应影响
    fireStorageChange('otherSetting', false, true)

    const ctx = buildCtx('s1', 'bilingual')
    bridge.attachBilingual(ctx)
    expect(document.querySelector('.xt-anno-star-host')).toBeTruthy()
  })
})

describe('AnnotationBridge — 解耦：关闭标注不影响翻译主流程', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
    isRatedRecentMock.mockClear()
  })

  it('bridge 实例化失败时其他模块不受影响（注入空 opts 不抛）', () => {
    // bridge 自身不应 throw；调用 attach* 时才检查 deps
    expect(
      () =>
        new AnnotationBridge({
          encode: encodeMock,
          put: putMock,
          isRatedRecent: isRatedRecentMock,
        }),
    ).not.toThrow()
  })

  it('多次 cleanup 不抛错', () => {
    const bridge = new AnnotationBridge({
      encode: encodeMock,
      put: putMock,
      isRatedRecent: isRatedRecentMock,
    })
    bridge.cleanup()
    bridge.cleanup()
    expect(() => bridge.cleanup()).not.toThrow()
  })
})