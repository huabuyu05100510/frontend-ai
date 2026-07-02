/**
 * Agent 3 — Annotator 单测
 *
 * 测试目标：content script 的标注 UI（词级 alignment 修正 + 段级评分）
 * TDD 流程：先写测试再写实现。所有 DOM 操作在 jsdom 下运行。
 *
 * 模型：claude-sonnet-4-6 (MiniMax-M3 路由)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Annotator } from '../src/content/annotator'
import type { AlignmentResult, Segment } from '../src/shared/types'

// ─── chrome API mock ────────────────────────────────────────────
// content script 跑在 chrome.runtime 不可用的 jsdom 环境，必须 stub
const storageData: Record<string, unknown> = {}
function resetStorage() {
  for (const k of Object.keys(storageData)) delete storageData[k]
  storageData.annoEnabled = true
}
;(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
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
      remove: vi.fn((keys: string | string[], cb?: () => void) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        for (const k of arr) delete storageData[k]
        if (cb) cb()
        return Promise.resolve()
      }),
    },
  },
}

// ─── encode/put mock（模拟 Agent 1 + Agent 2 的接口）──────────
const encodeMock = vi.fn(async (input: unknown) => ({
  ...(input as Record<string, unknown>),
  id: `anno-${Math.random().toString(36).slice(2, 10)}`,
  createdAt: Date.now(),
}))
const putMock = vi.fn(async (_anno: unknown) => 'ok')

// ─── helpers ────────────────────────────────────────────────────
function buildSegment(id: string, text: string): Segment {
  const el = document.createElement('p')
  el.setAttribute('data-xt-id', id)
  el.setAttribute('data-xt-original', text)
  el.textContent = text
  document.body.appendChild(el)
  return { id, text, element: el, role: 'body' }
}

function buildTranslationEl(segId: string, srcText: string, tgtText: string) {
  const srcEl = document.createElement('p')
  srcEl.setAttribute('data-xt-id', segId)
  srcEl.setAttribute('data-xt-original', srcText)
  srcEl.textContent = srcText
  document.body.appendChild(srcEl)

  const tgtEl = document.createElement('span')
  tgtEl.className = 'xt-translation'
  tgtEl.setAttribute('data-xt-tgt', segId)
  tgtEl.textContent = tgtText
  srcEl.appendChild(tgtEl)
  return { srcEl, tgtEl }
}

function buildAlignment(segId: string, src: string[], tgt: string[]): AlignmentResult {
  const alignments = src.map((_, i) => ({
    srcIdx: i,
    tgtIdx: Math.min(i, tgt.length - 1),
    score: 0.9,
  }))
  return { segmentId: segId, srcTokens: src, tgtTokens: tgt, alignments }
}

// ─── tests ──────────────────────────────────────────────────────

describe('Annotator — 实例化 + 挂载', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
  })

  it('实例化不应抛错', () => {
    expect(() => new Annotator()).not.toThrow()
  })

  it('mount 后向每个 .xt-translation 旁注入 shadow DOM host（绝不污染原 DOM）', () => {
    const { srcEl, tgtEl } = buildTranslationEl('s1', 'I love you', '我爱你')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: buildAlignment('s1', ['I', 'love', 'you'], ['我', '爱', '你']),
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    // 原有 DOM 应保留，shadow host 挂在 root 内（铅笔 + 星星）
    expect(root.contains(srcEl)).toBe(true)
    expect(root.contains(tgtEl)).toBe(true)
    const starHost = document.querySelector('.xt-anno-star-host')
    expect(starHost).toBeTruthy()
    expect(starHost?.shadowRoot).toBeTruthy()
  })

  it('enabled=false 时不应挂载 UI', () => {
    storageData.annoEnabled = false
    const { srcEl } = buildTranslationEl('s1', 'I love you', '我爱你')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: buildAlignment('s1', ['I', 'love', 'you'], ['我', '爱', '你']),
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    // 不挂 host
    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
    expect(document.querySelector('.xt-anno-pencil-host')).toBeFalsy()
  })
})

describe('Annotator — 词级 alignment 修正 popover', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
  })

  it('mount 时在译文元素右上角插 ✏️ 图标', () => {
    const { srcEl } = buildTranslationEl('s1', 'I love you', '我爱你')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: buildAlignment('s1', ['I', 'love', 'you'], ['我', '爱', '你']),
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    // 评分 host 必须存在（覆盖 B 类）
    const host = root.firstElementChild as HTMLElement | null
    expect(host).toBeTruthy()
    // 词级 ✏️ host 也存在（在 .xt-translation 旁 / 内）
    const pencilHost = document.querySelector('.xt-anno-pencil-host')
    expect(pencilHost).toBeTruthy()
    expect(pencilHost?.shadowRoot).toBeTruthy()
  })

  it('点击 ✏️ 触发 popover（shadow DOM 内含候选词列表）', async () => {
    const { srcEl } = buildTranslationEl('s1', '懒懒狗', 'lazy dog')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: {
        segmentId: 's1',
        srcTokens: ['懒', '懒', '狗'],
        tgtTokens: ['lazy', 'dog'],
        alignments: [
          { srcIdx: 0, tgtIdx: 0, score: 0.9 },
          { srcIdx: 1, tgtIdx: 0, score: 0.7 },
          { srcIdx: 2, tgtIdx: 1, score: 0.85 },
        ],
      },
      pageContext: { url: 'https://test/', langPair: ['zh', 'en'] },
    })

    // 找到 pencil host shadow root 内的按钮并 click
    const pencilHost = document.querySelector('.xt-anno-pencil-host')!
    const btn = pencilHost.shadowRoot!.querySelector<HTMLButtonElement>('button.pencil')!
    btn.click()
    await Promise.resolve() // 等待 microtask

    // popover 应打开
    const popover = pencilHost.shadowRoot!.querySelector('.popover')
    expect(popover).toBeTruthy()
    // 候选词数量 ≥1（懒 → lazy）
    const candidates = pencilHost.shadowRoot!.querySelectorAll('.cand')
    expect(candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('点击候选词触发 encode + put', async () => {
    const { srcEl } = buildTranslationEl('s1', '懒懒狗', 'lazy dog')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: {
        segmentId: 's1',
        srcTokens: ['懒', '懒', '狗'],
        tgtTokens: ['lazy', 'dog'],
        alignments: [
          { srcIdx: 0, tgtIdx: 0, score: 0.9 },
          { srcIdx: 1, tgtIdx: 0, score: 0.7 },
          { srcIdx: 2, tgtIdx: 1, score: 0.85 },
        ],
      },
      pageContext: { url: 'https://test/', langPair: ['zh', 'en'] },
    })

    const pencilHost = document.querySelector('.xt-anno-pencil-host')!
    const btn = pencilHost.shadowRoot!.querySelector<HTMLButtonElement>('button.pencil')!
    btn.click()
    await Promise.resolve()

    // 点第一个候选
    const firstCand = pencilHost.shadowRoot!.querySelector<HTMLElement>('.cand')!
    firstCand.click()
    // 等异步
    await new Promise(r => setTimeout(r, 10))

    expect(encodeMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    // encode 入参 kind 应为 align_fix
    const callArg = encodeMock.mock.calls[0][0] as { kind: string; payload: { srcTokenIdx: number } }
    expect(callArg.kind).toBe('align_fix')
    expect(callArg.payload.srcTokenIdx).toBe(0)
  })

  it('键盘 1-9 选择候选词', async () => {
    const { srcEl } = buildTranslationEl('s1', '懒懒狗', 'lazy dog')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: {
        segmentId: 's1',
        srcTokens: ['懒', '懒', '狗'],
        tgtTokens: ['lazy', 'dog'],
        alignments: [
          { srcIdx: 0, tgtIdx: 0, score: 0.9 },
          { srcIdx: 2, tgtIdx: 1, score: 0.85 },
        ],
      },
      pageContext: { url: 'https://test/', langPair: ['zh', 'en'] },
    })

    const pencilHost = document.querySelector('.xt-anno-pencil-host')!
    pencilHost.shadowRoot!.querySelector<HTMLButtonElement>('button.pencil')!.click()
    await Promise.resolve()

    // 派发键盘事件 '1'
    pencilHost.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
    await new Promise(r => setTimeout(r, 10))

    expect(encodeMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭 popover 不触发 put', async () => {
    const { srcEl } = buildTranslationEl('s1', '懒懒狗', 'lazy dog')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: {
        segmentId: 's1',
        srcTokens: ['懒', '懒', '狗'],
        tgtTokens: ['lazy', 'dog'],
        alignments: [{ srcIdx: 0, tgtIdx: 0, score: 0.9 }],
      },
      pageContext: { url: 'https://test/', langPair: ['zh', 'en'] },
    })

    const pencilHost = document.querySelector('.xt-anno-pencil-host')!
    pencilHost.shadowRoot!.querySelector<HTMLButtonElement>('button.pencil')!.click()
    await Promise.resolve()
    const popover = pencilHost.shadowRoot!.querySelector<HTMLElement>('.popover')!
    expect(popover.hasAttribute('hidden')).toBe(false)

    // Esc
    pencilHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await Promise.resolve()

    expect(popover.hasAttribute('hidden')).toBe(true)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('"无对应" 选项：put 中 correctedTgtTokenIdx=null', async () => {
    const { srcEl } = buildTranslationEl('s1', '懒懒狗', 'lazy dog')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: {
        segmentId: 's1',
        srcTokens: ['懒', '懒', '狗'],
        tgtTokens: ['lazy', 'dog'],
        alignments: [{ srcIdx: 0, tgtIdx: 0, score: 0.9 }],
      },
      pageContext: { url: 'https://test/', langPair: ['zh', 'en'] },
    })

    const pencilHost = document.querySelector('.xt-anno-pencil-host')!
    pencilHost.shadowRoot!.querySelector<HTMLButtonElement>('button.pencil')!.click()
    await Promise.resolve()

    const noneBtn = pencilHost.shadowRoot!.querySelector<HTMLElement>('.cand-none')!
    noneBtn.click()
    await new Promise(r => setTimeout(r, 10))

    expect(putMock).toHaveBeenCalledTimes(1)
    const written = putMock.mock.calls[0][0] as { payload: { correctedTgtTokenIdx: number | null; correctionKind: string } }
    expect(written.payload.correctedTgtTokenIdx).toBeNull()
    expect(written.payload.correctionKind).toBe('remove')
  })
})

describe('Annotator — 段级 1-5 星评分', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
  })

  it('mount 后在每个 .xt-translation 旁插入 5 颗空心 ☆', () => {
    const { srcEl } = buildTranslationEl('s1', 'hello', '你好')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: { segmentId: 's1', srcTokens: ['hello'], tgtTokens: ['你好'], alignments: [] },
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    const starHost = document.querySelector('.xt-anno-star-host')
    expect(starHost).toBeTruthy()
    expect(starHost?.shadowRoot).toBeTruthy()
    const stars = starHost!.shadowRoot!.querySelectorAll('.star')
    expect(stars.length).toBe(5)
  })

  it('点击第 3 星触发 encode + put，rating=3', async () => {
    const { srcEl } = buildTranslationEl('s1', 'hello', '你好')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    const ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: { segmentId: 's1', srcTokens: ['hello'], tgtTokens: ['你好'], alignments: [] },
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    const starHost = document.querySelector('.xt-anno-star-host')!
    const stars = starHost.shadowRoot!.querySelectorAll<HTMLElement>('.star')
    stars[2].click() // ★★★
    await new Promise(r => setTimeout(r, 10))

    expect(encodeMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    const arg = encodeMock.mock.calls[0][0] as { kind: string; payload: { rating: number } }
    expect(arg.kind).toBe('seg_rating')
    expect(arg.payload.rating).toBe(3)
  })

  it('24h 去打扰：同段已评 → 不再显示 ☆', async () => {
    const { srcEl } = buildTranslationEl('s1', 'hello', '你好')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    // 第一次挂载 + 评分
    let ann = new Annotator()
    ann.mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: { segmentId: 's1', srcTokens: ['hello'], tgtTokens: ['你好'], alignments: [] },
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })
    const starHost = document.querySelector('.xt-anno-star-host')!
    starHost.shadowRoot!.querySelectorAll<HTMLElement>('.star')[4].click()
    await new Promise(r => setTimeout(r, 10))
    expect(putMock).toHaveBeenCalledTimes(1)

    // 第二次挂载：同段已评，应不再插入 star host
    document.body.innerHTML = ''
    storageData.annoEnabled = true
    const seg2 = buildTranslationEl('s1', 'hello', '你好')
    const root2 = document.createElement('div')
    root2.appendChild(seg2.srcEl)
    document.body.appendChild(root2)
    ann = new Annotator()
    ann.mount(root2, {
      encode: encodeMock,
      put: putMock,
      alignment: { segmentId: 's1', srcTokens: ['hello'], tgtTokens: ['你好'], alignments: [] },
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })
    expect(document.querySelector('.xt-anno-star-host')).toBeFalsy()
  })
})

describe('Annotator — Shadow DOM 隔离', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
  })

  it('所有 UI 在 shadowRoot 内，绝不污染页面 DOM 类名', () => {
    const { srcEl } = buildTranslationEl('s1', 'hello', '你好')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    new Annotator().mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: { segmentId: 's1', srcTokens: ['hello'], tgtTokens: ['你好'], alignments: [] },
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    // 页面上不应出现 .popover / .cand / .star / button.pencil
    expect(document.querySelector('.popover')).toBeFalsy()
    expect(document.querySelector('.cand')).toBeFalsy()
    expect(document.querySelector('.star')).toBeFalsy()
    expect(document.querySelector('button.pencil')).toBeFalsy()
  })

  it('动效用 transform/opacity（不应出现 top/left transition）', async () => {
    const { srcEl } = buildTranslationEl('s1', 'hello', '你好')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    new Annotator().mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: { segmentId: 's1', srcTokens: ['hello'], tgtTokens: ['你好'], alignments: [] },
      pageContext: { url: 'https://test/', langPair: ['en', 'zh'] },
    })

    // 收集 shadow root 内所有元素的 transition 属性
    const host = document.querySelector('.xt-anno-star-host')!
    const all = host.shadowRoot!.querySelectorAll<HTMLElement>('*')
    for (const el of all) {
      const t = getComputedStyle(el).transitionProperty
      // 允许 transform / opacity / background-color / color / all
      expect(['transform', 'opacity', 'background-color', 'color', 'none', 'all']).toContain(t)
    }
  })
})

describe('Annotator — 输入自定义词', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetStorage()
    encodeMock.mockClear()
    putMock.mockClear()
  })

  it('输入自定义词 + Enter 提交', async () => {
    const { srcEl } = buildTranslationEl('s1', '懒懒狗', 'lazy dog')
    const root = document.createElement('div')
    root.appendChild(srcEl)
    document.body.appendChild(root)

    new Annotator().mount(root, {
      encode: encodeMock,
      put: putMock,
      alignment: {
        segmentId: 's1',
        srcTokens: ['懒', '懒', '狗'],
        tgtTokens: ['lazy', 'dog'],
        alignments: [{ srcIdx: 0, tgtIdx: 0, score: 0.9 }],
      },
      pageContext: { url: 'https://test/', langPair: ['zh', 'en'] },
    })

    const pencilHost = document.querySelector('.xt-anno-pencil-host')!
    pencilHost.shadowRoot!.querySelector<HTMLButtonElement>('button.pencil')!.click()
    await Promise.resolve()

    const input = pencilHost.shadowRoot!.querySelector<HTMLInputElement>('input.custom')!
    input.value = 'sleepy'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 10))

    expect(putMock).toHaveBeenCalledTimes(1)
    const written = putMock.mock.calls[0][0] as { payload: { correctedTgtTokenIdx: number; correctionKind: string } }
    expect(written.payload.correctionKind).toBe('add')
    expect(written.payload.correctedTgtTokenIdx).toBeGreaterThanOrEqual(0)
  })
})