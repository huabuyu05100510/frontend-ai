// TranslationLayout v5.1 — 选区联动 + 源文字层测试
// 模型：claude-sonnet-4-6
//
// 覆盖：
//   - 源面板文字层从 /api/files/:id?as=text&n=N 拉取
//   - annotateSourceTextLayer 打上 data-src-idx-start/end
//   - 选中目标面板 span（data-src-idx）→ 源面板对应 span 有 .is-selected
//   - 选中源面板 span（data-src-idx-start/end）→ 目标面板对应 span 有 .is-selected
//   - 选区清空 → .is-selected 全部移除

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { TranslationLayout, __resetPageRenderCacheForTest } from '../src/inspect/TranslationLayout'
import { useStore } from '../src/store'
import type { Task, TranslateResponse } from '../src/types'

function docxTask(over: Partial<Task> = {}): Task {
  return {
    id: 'sel-1', name: 'sel.docx', size: 100, ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: 'docx',
    convertStatus: 'done', status: 'ready',
    pages: [{ page: 1, url: '/api/files/sel-1?as=page&n=1', width: 800, height: 1100 }],
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

const RESULT: TranslateResponse = {
  sourceLang: 'zh-CN', targetLang: 'en',
  segments: [{ index: 0, source: '你好世界', target: '你好世界' }],
  paragraphBlocks: [{ kind: 'equal', leftText: '你好世界', rightText: '你好世界' }],
  pages: [{
    page: 1, sourceText: '你好世界', targetText: '你好世界',
    pageW: 800, pageH: 1100, startLine: 1, endLine: 1,
    charMap: [
      { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
      { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
      { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
      { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 },
    ],
  }],
  ms: 1,
  meta: { segmentsCount: 1, pagesCount: 1, sourceChars: 4, targetChars: 4, engine: 'identity-mock-v1' },
}

// pdfium v4 text-layer HTML（3 个 run spans，覆盖「你好世界」）
const SOURCE_TEXT_LAYER = `<div class="pdf-text-layer" data-pdfium="4" data-page-w="800" data-page-h="1100"><span style="position:absolute;left:10px;top:10px;width:30px;height:14px;font-size:14px">你好</span><span style="position:absolute;left:40px;top:10px;width:30px;height:14px;font-size:14px">世界</span></div>`

// 目标文字层：char-level spans with data-src-idx
const TARGET_TEXT_LAYER = `<div class="pdf-text-layer" data-pdfium="6" data-page-w="800" data-page-h="1100"><span data-tgt-idx="0" data-src-idx="0" style="position:absolute;left:10px;top:10px;width:15px;height:14px;font-size:14px">你</span><span data-tgt-idx="1" data-src-idx="1" style="position:absolute;left:25px;top:10px;width:15px;height:14px;font-size:14px">好</span><span data-tgt-idx="2" data-src-idx="2" style="position:absolute;left:40px;top:10px;width:15px;height:14px;font-size:14px">世</span><span data-tgt-idx="3" data-src-idx="3" style="position:absolute;left:55px;top:10px;width:15px;height:14px;font-size:14px">界</span></div>`

class MockIO {
  cb: IntersectionObserverCallback
  observed: Element[] = []
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) { this.observed.push(el); (el as any).__mockObs = this }
  unobserve() {}
  disconnect() { this.observed = [] }
  takeRecords() { return [] }
}
;(globalThis as any).IntersectionObserver = MockIO

if (typeof URL.createObjectURL !== 'function') {
  let id = 1
  ;(URL as any).createObjectURL = () => `blob:mock/${id++}`
  ;(URL as any).revokeObjectURL = () => {}
}

function triggerInView(testId: string) {
  const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement
  if (!el) return
  const obs = (el as any).__mockObs as MockIO | undefined
  if (obs) obs.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 } as any], obs as any)
}

beforeEach(() => {
  localStorage.clear()
  __resetPageRenderCacheForTest()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TranslationLayout v5.1 — 源文字层 + 选区联动', () => {
  it('1. 源面板拉取 /api/files/:id?as=text&n=N 并注入 data-src-idx-start/end', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: RESULT, translateError: null,
    })

    const fetchCalls: string[] = []
    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCalls.push(url)
      if (url.includes('?as=text')) {
        return { ok: true, status: 200, text: async () => SOURCE_TEXT_LAYER, json: async () => ({}), blob: async () => ({}) } as any
      }
      if (url.includes('/render-image')) {
        return { ok: true, status: 200, headers: { get: (k: string) => ({ 'x-translate-page-w': '800', 'x-translate-page-h': '1100' }[k.toLowerCase()] || null) }, blob: async () => ({ size: 100 }), text: async () => '' } as any
      }
      if (url.includes('/render-text')) {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => TARGET_TEXT_LAYER, blob: async () => ({}) } as any
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)

    // 等待源文字层 fetch
    await waitFor(() => {
      expect(fetchCalls.some(u => u.includes('?as=text'))).toBe(true)
    })

    // 源面板文字层 span 应有 data-src-idx-start/end
    await waitFor(() => {
      const spans = document.querySelectorAll('.ttl-src-scroll .pdf-text-layer span[data-src-idx-start]')
      expect(spans.length).toBeGreaterThan(0)
    })

    // v5.2 char-level：每个汉字一个 span，共 4 个 span
    const spans = Array.from(document.querySelectorAll<HTMLElement>('.ttl-src-scroll .pdf-text-layer span[data-src-idx-start]'))
    expect(spans.length).toBe(4)

    const ni = spans.find(s => s.textContent === '你')
    expect(ni?.getAttribute('data-src-idx-start')).toBe('0')
    expect(ni?.getAttribute('data-src-idx-end')).toBe('1')

    const hao = spans.find(s => s.textContent === '好')
    expect(hao?.getAttribute('data-src-idx-start')).toBe('1')
    expect(hao?.getAttribute('data-src-idx-end')).toBe('2')

    const shi = spans.find(s => s.textContent === '世')
    expect(shi?.getAttribute('data-src-idx-start')).toBe('2')
    expect(shi?.getAttribute('data-src-idx-end')).toBe('3')

    const jie = spans.find(s => s.textContent === '界')
    expect(jie?.getAttribute('data-src-idx-start')).toBe('3')
    expect(jie?.getAttribute('data-src-idx-end')).toBe('4')
  })

  it('2. 选中目标面板 data-src-idx="1/2" → 源面板覆盖范围 span 加 .is-selected', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: RESULT, translateError: null,
    })

    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('?as=text')) return { ok: true, status: 200, text: async () => SOURCE_TEXT_LAYER, json: async () => ({}), blob: async () => ({}) } as any
      if (url.includes('/render-image')) return { ok: true, status: 200, headers: { get: (k: string) => ({ 'x-translate-page-w': '800', 'x-translate-page-h': '1100' }[k.toLowerCase()] || null) }, blob: async () => ({ size: 100 }), text: async () => '' } as any
      if (url.includes('/render-text')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => TARGET_TEXT_LAYER, blob: async () => ({}) } as any
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)

    // 等源文字层加载 + 触发右 cell IO
    await waitFor(() => {
      expect(document.querySelectorAll('.ttl-src-scroll .pdf-text-layer span[data-src-idx-start]').length).toBeGreaterThan(0)
    })
    await act(async () => { triggerInView('translate-tgt-page-1') })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="translate-tgt-page-1"] span[data-src-idx="1"]')).toBeTruthy()
    })

    // 模拟目标面板选中 src-idx 1 + 2
    const span1 = document.querySelector<HTMLElement>('[data-testid="translate-tgt-page-1"] span[data-src-idx="1"]')!
    const span2 = document.querySelector<HTMLElement>('[data-testid="translate-tgt-page-1"] span[data-src-idx="2"]')!
    expect(span1).toBeTruthy()
    expect(span2).toBeTruthy()

    // 构造跨越 span1..span2 的 Range
    const range = document.createRange()
    range.setStartBefore(span1)
    range.setEndAfter(span2)

    // mock window.getSelection
    const mockSel = {
      isCollapsed: false, rangeCount: 1,
      getRangeAt: () => range,
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSel as any)

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
    })

    // 源面板「好」(1-2) 与「世」(2-3) 与 [1,3) 有重叠 → .is-selected
    const hao = Array.from(document.querySelectorAll<HTMLElement>('.ttl-src-scroll span[data-src-idx-start]'))
      .find(s => s.textContent === '好')
    expect(hao?.classList.contains('is-selected')).toBe(true)
    const shi = Array.from(document.querySelectorAll<HTMLElement>('.ttl-src-scroll span[data-src-idx-start]'))
      .find(s => s.textContent === '世')
    expect(shi?.classList.contains('is-selected')).toBe(true)
    // 「你」(0-1) 不在 [1,3) 范围内 → 不高亮
    const ni = Array.from(document.querySelectorAll<HTMLElement>('.ttl-src-scroll span[data-src-idx-start]'))
      .find(s => s.textContent === '你')
    expect(ni?.classList.contains('is-selected')).toBe(false)
  })

  it('3. 选中源面板 span（data-src-idx-start=0 end=2）→ 目标面板 src-idx 0/1 加 .is-selected', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: RESULT, translateError: null,
    })

    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('?as=text')) return { ok: true, status: 200, text: async () => SOURCE_TEXT_LAYER, json: async () => ({}), blob: async () => ({}) } as any
      if (url.includes('/render-image')) return { ok: true, status: 200, headers: { get: (k: string) => ({ 'x-translate-page-w': '800', 'x-translate-page-h': '1100' }[k.toLowerCase()] || null) }, blob: async () => ({ size: 100 }), text: async () => '' } as any
      if (url.includes('/render-text')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => TARGET_TEXT_LAYER, blob: async () => ({}) } as any
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)

    await waitFor(() => {
      expect(document.querySelectorAll('.ttl-src-scroll .pdf-text-layer span[data-src-idx-start]').length).toBeGreaterThan(0)
    })
    await act(async () => { triggerInView('translate-tgt-page-1') })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="translate-tgt-page-1"] span[data-src-idx="0"]')).toBeTruthy()
    })

    // v5.2 char-level：选中「你」span（srcStart=0, srcEnd=1）→ 目标 idx=0 高亮，idx=1 不高亮
    const niSpan = Array.from(document.querySelectorAll<HTMLElement>('.ttl-src-scroll span[data-src-idx-start]'))
      .find(s => s.textContent === '你')!
    expect(niSpan).toBeTruthy()

    const range = document.createRange()
    range.selectNode(niSpan)

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false, rangeCount: 1, getRangeAt: () => range,
    } as any)

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
    })

    // 目标面板 data-src-idx=0 应有 .is-selected
    const tgtSpan0 = document.querySelector<HTMLElement>('[data-testid="translate-tgt-page-1"] span[data-src-idx="0"]')!
    expect(tgtSpan0?.classList.contains('is-selected')).toBe(true)
    // data-src-idx=1/2/3 不应高亮（srcEnd=1，不含 1）
    const tgtSpan1 = document.querySelector<HTMLElement>('[data-testid="translate-tgt-page-1"] span[data-src-idx="1"]')
    expect(tgtSpan1?.classList.contains('is-selected')).toBe(false)
  })

  it('4. 选区清空（isCollapsed=true）→ .is-selected 全部移除', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: RESULT, translateError: null,
    })

    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('?as=text')) return { ok: true, status: 200, text: async () => SOURCE_TEXT_LAYER, json: async () => ({}), blob: async () => ({}) } as any
      if (url.includes('/render-image')) return { ok: true, status: 200, headers: { get: (k: string) => ({ 'x-translate-page-w': '800', 'x-translate-page-h': '1100' }[k.toLowerCase()] || null) }, blob: async () => ({ size: 100 }), text: async () => '' } as any
      if (url.includes('/render-text')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => TARGET_TEXT_LAYER, blob: async () => ({}) } as any
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)

    await waitFor(() => {
      expect(document.querySelectorAll('.ttl-src-scroll .pdf-text-layer span[data-src-idx-start]').length).toBeGreaterThan(0)
    })
    await act(async () => { triggerInView('translate-tgt-page-1') })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="translate-tgt-page-1"] span[data-src-idx="0"]')).toBeTruthy()
    })

    // 先触发一次选区联动（选「你」span，char-level）
    const niHaoSpan = Array.from(document.querySelectorAll<HTMLElement>('.ttl-src-scroll span[data-src-idx-start]'))
      .find(s => s.textContent === '你')!
    const range = document.createRange()
    range.selectNode(niHaoSpan)
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, rangeCount: 1, getRangeAt: () => range } as any)
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })

    // 验证有 .is-selected
    expect(document.querySelectorAll('.is-selected').length).toBeGreaterThan(0)

    // 清空选区
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true, rangeCount: 0 } as any)
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })

    // 所有 .is-selected 应被清除
    expect(document.querySelectorAll('.is-selected').length).toBe(0)
  })
})
