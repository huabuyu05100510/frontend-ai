import { describe, it, expect, beforeEach } from 'vitest'
import { TranslationInjector } from '../../src/content/injector'
import type { AlignmentResult } from '../../src/shared/types'

// jsdom：document 可用

/**
 * W1-5 单测：injector.applyAlignment + wrapTokens 行为
 */
describe('TranslationInjector — applyAlignment', () => {
  let srcEl: HTMLElement
  let tgtEl: HTMLElement
  let injector: TranslationInjector

  beforeEach(() => {
    document.body.innerHTML = ''
    srcEl = document.createElement('p')
    srcEl.setAttribute('data-xt-id', 's1')
    srcEl.textContent = 'I love you'
    document.body.appendChild(srcEl)

    tgtEl = document.createElement('p')
    tgtEl.setAttribute('data-xt-tgt', 's1')
    tgtEl.textContent = '我爱你'
    document.body.appendChild(tgtEl)

    injector = new TranslationInjector()
    // 模拟 inject 流程：把 tgtEl 登记进 injector
    ;(injector as unknown as { injected: Map<string, Element> }).injected.set('s1', tgtEl)
  })

  it('tgt 元素被切成 3 个 span（一字一 token）', () => {
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

    const tgtSpans = tgtEl.querySelectorAll('[data-xt-tok="tgt"]')
    expect(tgtSpans.length).toBe(3)
    expect(tgtSpans[0].textContent).toBe('我')
    expect(tgtSpans[2].textContent).toBe('你')
    expect(tgtSpans[0].getAttribute('data-xt-idx')).toBe('0')
    expect(tgtSpans[0].getAttribute('data-xt-seg')).toBe('s1')
  })

  it('src 元素也被切成 span（且不破坏 data-xt-id）', () => {
    const alignment: AlignmentResult = {
      segmentId: 's1',
      srcTokens: ['I', 'love', 'you'],
      tgtTokens: ['我', '爱', '你'],
      alignments: [],
    }
    injector.applyAlignment('s1', alignment)

    expect(srcEl.getAttribute('data-xt-id')).toBe('s1')
    const srcSpans = srcEl.querySelectorAll('[data-xt-tok="src"]')
    expect(srcSpans.length).toBe(3)
  })

  it('重复 applyAlignment 幂等（不二次切分）', () => {
    const alignment: AlignmentResult = {
      segmentId: 's1',
      srcTokens: ['I', 'love', 'you'],
      tgtTokens: ['我', '爱', '你'],
      alignments: [],
    }
    injector.applyAlignment('s1', alignment)
    injector.applyAlignment('s1', alignment)

    expect(tgtEl.querySelectorAll('[data-xt-tok="tgt"]').length).toBe(3)
    expect(srcEl.querySelectorAll('[data-xt-tok="src"]').length).toBe(3)
  })

  it('unwrapTokens 后恢复纯文本', () => {
    const alignment: AlignmentResult = {
      segmentId: 's1',
      srcTokens: ['I', 'love', 'you'],
      tgtTokens: ['我', '爱', '你'],
      alignments: [],
    }
    injector.applyAlignment('s1', alignment)
    injector.restore()

    // tgt 元素被 restore 删除（bilingual 模式）
    expect(document.querySelector('[data-xt-tgt="s1"]')).toBeNull()
    // src 元素保留但 token span 已 unwrap
    expect(srcEl.querySelectorAll('[data-xt-tok]').length).toBe(0)
    // data-xt-id 标记被清
    expect(document.querySelector('[data-xt-id]')).toBeNull()
  })

  it('英文 token 之间有空格 text node', () => {
    const alignment: AlignmentResult = {
      segmentId: 's1',
      srcTokens: ['The', 'fox'],
      tgtTokens: ['狐', '狸'],
      alignments: [],
    }
    injector.applyAlignment('s1', alignment)

    // srcEl 子节点应包含 text node（空格）+ span + text + span
    const textNodes = Array.from(srcEl.childNodes).filter(n => n.nodeType === 3)
    expect(textNodes.length).toBeGreaterThanOrEqual(1)
    // 第一 span 后必有空格
    const firstSpan = srcEl.querySelector('[data-xt-tok="src"]')!
    const next = firstSpan.nextSibling
    expect(next?.nodeType).toBe(Node.TEXT_NODE)
  })
})

/**
 * Hover 高亮逻辑模拟：模拟 content.ts setupHoverDelegation 的核心
 */
describe('Hover delegation — 逻辑模拟', () => {
  /**
   * 给定 alignments + (side, idx)，返回应高亮的对侧 idx 集合
   * 与 content.ts 中的逻辑一致
   */
  function findPairs(
    alignments: { srcIdx: number; tgtIdx: number }[],
    side: 'src' | 'tgt',
    idx: number,
  ): Set<number> {
    const out = new Set<number>()
    for (const a of alignments) {
      if (side === 'src' && a.srcIdx === idx) out.add(a.tgtIdx)
      if (side === 'tgt' && a.tgtIdx === idx) out.add(a.srcIdx)
    }
    return out
  }

  it('一对一：src 1 → tgt 1', () => {
    const pairs = findPairs([{ srcIdx: 1, tgtIdx: 1 }], 'src', 1)
    expect([...pairs]).toEqual([1])
  })

  it('多对一：src 0,6 → tgt 10（"the"/"lazy" → "懒"）', () => {
    const alignments = [
      { srcIdx: 0, tgtIdx: 10 },
      { srcIdx: 6, tgtIdx: 10 },
    ]
    expect([...findPairs(alignments, 'tgt', 10)].sort()).toEqual([0, 6])
  })

  it('无匹配：返回空集合', () => {
    expect(findPairs([{ srcIdx: 1, tgtIdx: 1 }], 'src', 99).size).toBe(0)
  })
})
