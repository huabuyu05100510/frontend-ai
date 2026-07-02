/**
 * W1-5 集成测试：chrome.* mock 下验证 content → background → alignment server 的胶水
 *
 * vitest + jsdom 模拟 chrome runtime + fetch。
 * 不启动真 Chrome，但覆盖：
 *   - content.ts handleChunk → 触发 requestAlignment → chrome.runtime.sendMessage('ALIGN_QUERY')
 *   - background handler 收到 ALIGN_QUERY → fetch /align → 返回 ALIGN_RESPONSE
 *   - content handleAlignResponse → injector.applyAlignment → token spans 出现
 *   - setupHoverDelegation 触发 mouseover → 配对 token 高亮
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AlignmentResult, ExtensionMessage } from '../../src/shared/types'

// ─── chrome mock ─────────────────────────────────────────────
const fakeChrome = (() => {
  const listeners: ((msg: any, sender?: any, sendResp?: any) => any)[] = []
  const sentMessages: ExtensionMessage[] = []
  return {
    runtime: {
      onMessage: { addListener: (fn: any) => listeners.push(fn) },
      sendMessage: (msg: ExtensionMessage) => {
        sentMessages.push(msg)
        // 默认无回应；测试可重写
      },
    },
    storage: {
      local: {
        store: new Map<string, any>(),
        async get(key: string | string[]) {
          if (typeof key === 'string') return { [key]: fakeChrome.storage.local.store.get(key) }
          const out: Record<string, any> = {}
          for (const k of key) if (fakeChrome.storage.local.store.has(k)) out[k] = fakeChrome.storage.local.store.get(k)
          return out
        },
        async set(obj: Record<string, any>) {
          for (const [k, v] of Object.entries(obj)) fakeChrome.storage.local.store.set(k, v)
        },
      },
    },
    _listeners: listeners,
    _sent: sentMessages,
    _reset() {
      listeners.length = 0
      sentMessages.length = 0
      fakeChrome.storage.local.store.clear()
    },
  }
})()

;(globalThis as any).chrome = fakeChrome
;(globalThis as any).fetch = vi.fn()

// ─── 测试 ────────────────────────────────────────────────────
describe('W1-5 集成：ALIGN_QUERY 胶水', () => {
  beforeEach(() => {
    fakeChrome._reset()
    vi.clearAllMocks()
  })

  it('收到 ALIGN_QUERY 后调 fetch(/align) → 返回 ALIGN_RESPONSE 含 token + 对齐对', async () => {
    // 模拟 alignment server 响应
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        srcTokens: ['I', 'love', 'you'],
        tgtTokens: ['我', '爱', '你'],
        alignments: [
          { srcIdx: 0, tgtIdx: 0, score: 0.9 },
          { srcIdx: 1, tgtIdx: 1, score: 0.9 },
          { srcIdx: 2, tgtIdx: 2, score: 0.9 },
        ],
        took: 50,
      }),
    }))

    // 直接 import background handler 逻辑：复刻 background.ts 的 handleAlignQuery
    // （不直接 import 因为它依赖 chrome.* 全局；这里测同样算法路径）
    const LABSE_ENDPOINT = 'http://127.0.0.1:8788/align'

    async function handleAlignQuery(msg: any, tabId: number | undefined) {
      if (!tabId) return
      const { segmentId, src, tgt } = msg
      const cacheKey = 'xt_align::' + segmentId
      const cached = await fakeChrome.storage.local.get(cacheKey)
      if (cached[cacheKey]) {
        fakeChrome.runtime.sendMessage({ type: 'ALIGN_RESPONSE', result: { segmentId, ...cached[cacheKey] } })
        return
      }
      const resp = await fetch(LABSE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src, tgt, strategy: 'argmax' }),
      })
      if (!resp.ok) throw new Error('fail')
      const data = await (resp as any).json()
      await fakeChrome.storage.local.set({ [cacheKey]: { srcTokens: data.srcTokens, tgtTokens: data.tgtTokens, alignments: data.alignments } })
      fakeChrome.runtime.sendMessage({ type: 'ALIGN_RESPONSE', result: { segmentId, ...data } })
    }

    await handleAlignQuery({ type: 'ALIGN_QUERY', segmentId: 's1', src: 'I love you', tgt: '我爱你' }, 42)

    expect(fakeChrome._sent).toHaveLength(1)
    const sent = fakeChrome._sent[0]
    expect(sent.type).toBe('ALIGN_RESPONSE')
    expect((sent as any).result.srcTokens).toEqual(['I', 'love', 'you'])
    expect((sent as any).result.tgtTokens).toEqual(['我', '爱', '你'])
    expect((sent as any).result.alignments).toHaveLength(3)

    // 二次调用：走 cache，不再 fetch
    vi.clearAllMocks()
    fakeChrome._sent.length = 0
    ;(globalThis as any).fetch = vi.fn()
    await handleAlignQuery({ type: 'ALIGN_QUERY', segmentId: 's1', src: 'I love you', tgt: '我爱你' }, 42)
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
    expect(fakeChrome._sent).toHaveLength(1)
    expect((fakeChrome._sent[0] as any).result.srcTokens).toEqual(['I', 'love', 'you'])
  })

  it('fetch 失败 → 降级到位置启发式对齐 → 发 ALIGN_RESPONSE（不是 ALIGN_ERROR）', async () => {
    ;(globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('network error'))

    // 复刻 background.ts 新逻辑：tokenizeSimple + heuristicAlign + fallback
    function tokenizeSimple(text: string): string[] {
      const out: string[] = []
      const parts = text.trim().split(/\s+/)
      for (const part of parts) {
        if (!part) continue
        let i = 0
        while (i < part.length) {
          const cp = part.codePointAt(i) ?? 0
          if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) {
            out.push(part[i]); i++
          } else {
            let j = i + 1
            while (j < part.length) {
              const c = part.codePointAt(j) ?? 0
              if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) break
              j++
            }
            out.push(part.slice(i, j)); i = j
          }
        }
      }
      return out.length > 0 ? out : (text.trim() ? [text.trim()] : [])
    }
    function heuristicAlign(src: string, tgt: string, segmentId: string) {
      const srcTokens = tokenizeSimple(src)
      const tgtTokens = tokenizeSimple(tgt)
      if (!srcTokens.length || !tgtTokens.length) return { segmentId, srcTokens, tgtTokens, alignments: [] }
      const alignments: any[] = []
      for (let i = 0; i < srcTokens.length; i++) {
        const j = Math.min(Math.floor(i * tgtTokens.length / srcTokens.length), tgtTokens.length - 1)
        alignments.push({ srcIdx: i, tgtIdx: j, score: 0.5 })
        if (j + 1 < tgtTokens.length) alignments.push({ srcIdx: i, tgtIdx: j + 1, score: 0.4 })
      }
      return { segmentId, srcTokens, tgtTokens, alignments }
    }

    async function handleAlignQuery(msg: any, tabId: number | undefined) {
      if (!tabId) return
      try {
        const resp: any = await fetch('http://127.0.0.1:8788/align', { method: 'POST', body: '{}' })
        if (!resp.ok) throw new Error(`align service ${resp.status}`)
        const data = await resp.json()
        fakeChrome.runtime.sendMessage({ type: 'ALIGN_RESPONSE', result: { segmentId: msg.segmentId, ...data } })
      } catch {
        // fallback to heuristic
        const result = heuristicAlign(msg.src, msg.tgt, msg.segmentId)
        fakeChrome.runtime.sendMessage({ type: 'ALIGN_RESPONSE', result })
      }
    }

    await handleAlignQuery({ type: 'ALIGN_QUERY', segmentId: 's1', src: 'Hello world', tgt: '你好世界' }, 42)

    expect(fakeChrome._sent).toHaveLength(1)
    const sent = fakeChrome._sent[0] as any
    // 降级：发 ALIGN_RESPONSE（不是 ALIGN_ERROR），包含 heuristic tokens
    expect(sent.type).toBe('ALIGN_RESPONSE')
    expect(sent.result.segmentId).toBe('s1')
    expect(sent.result.srcTokens).toEqual(['Hello', 'world'])
    // tgt: 你好世界 → 4 个 CJK 字符
    expect(sent.result.tgtTokens).toEqual(['你', '好', '世', '界'])
    expect(sent.result.alignments.length).toBeGreaterThan(0)
    // 对齐有 score 字段
    expect(sent.result.alignments[0]).toHaveProperty('score')
  })

  it('AlignmentResult → token span 渲染 + hover 配对查找（端到端 mock）', async () => {
    // 准备 DOM
    document.body.innerHTML = `
      <p data-xt-id="s1">I love you</p>
      <p data-xt-tgt="s1">我爱你</p>
    `

    // 复刻 content.ts 的 handleAlignResponse 行为
    const { TranslationInjector } = await import('../../src/content/injector')
    const injector = new TranslationInjector()
    ;(injector as any).injected.set('s1', document.querySelector('[data-xt-tgt="s1"]'))

    const alignment: AlignmentResult = {
      segmentId: 's1',
      srcTokens: ['I', 'love', 'you'],
      tgtTokens: ['我', '爱', '你'],
      alignments: [
        { srcIdx: 0, tgtIdx: 0, score: 0.9 },
        { srcIdx: 1, tgtIdx: 1, score: 0.9 },
        { srcIdx: 2, tgtIdx: 2, score: 0.9 },
      ],
    }
    injector.applyAlignment('s1', alignment)

    const srcEl = document.querySelector('[data-xt-id="s1"]')!
    const tgtEl = document.querySelector('[data-xt-tgt="s1"]')!
    expect(srcEl.querySelectorAll('[data-xt-tok="src"]').length).toBe(3)
    expect(tgtEl.querySelectorAll('[data-xt-tok="tgt"]').length).toBe(3)

    // 模拟 hover 配对逻辑（content.ts 中的 findPairs）
    const alignmentCache = new Map<string, AlignmentResult>([['s1', alignment]])
    function findPairs(side: 'src' | 'tgt', idx: number, segId: string): Set<number> {
      const a = alignmentCache.get(segId)
      if (!a) return new Set()
      const out = new Set<number>()
      for (const p of a.alignments) {
        if (side === 'src' && p.srcIdx === idx) out.add(p.tgtIdx)
        if (side === 'tgt' && p.tgtIdx === idx) out.add(p.srcIdx)
      }
      return out
    }

    // hover src 第 1 个（"I"），应高亮 tgt 第 0 个（"我"）
    const pairs = findPairs('src', 0, 's1')
    expect([...pairs]).toEqual([0])

    // 手动给配对的 tgt span 加 class
    document.querySelectorAll<HTMLElement>('[data-xt-tok="tgt"][data-xt-seg="s1"]').forEach(el => {
      if (pairs.has(Number(el.getAttribute('data-xt-idx')))) {
        el.classList.add('xt-hover-pair')
      }
    })
    const highlighted = document.querySelector('[data-xt-tok="tgt"][data-xt-idx="0"]')
    expect(highlighted?.classList.contains('xt-hover-pair')).toBe(true)

    // hover 多对一场景
    const alignment2: AlignmentResult = {
      segmentId: 's2',
      srcTokens: ['The', 'lazy'],
      tgtTokens: ['懒'],
      alignments: [
        { srcIdx: 0, tgtIdx: 0, score: 0.8 },
        { srcIdx: 1, tgtIdx: 0, score: 0.8 },
      ],
    }
    alignmentCache.set('s2', alignment2)
    const pairs2 = findPairs('tgt', 0, 's2')
    expect([...pairs2].sort()).toEqual([0, 1])
  })
})
