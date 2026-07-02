// TranslationLayout v4.0 strategy 分支测试
// 模型：claude-sonnet-4-6
//
// 覆盖：
//   - DOCX/PDF 任务 → POST /api/inspect/translate 带 strategy='passthrough'
//   - txt/md 任务 → 不带 strategy（走 synthetic）
//   - 拉取右 cell 渲染时，render-image/render-text URL 带 strategy='passthrough'
//   - 切换 lang → 清缓存 + 重新触发拉取
//   - hover 右 cell span → setHoveredSrcIdx（data-src-idx 联动）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { TranslationLayout, __resetPageRenderCacheForTest } from '../src/inspect/TranslationLayout'
import { useStore } from '../src/store'
import type { Task, TranslateResponse } from '../src/types'

function docxTask(over: Partial<Task> = {}): Task {
  return {
    id: 'docx-1', name: '智检样例_原文.docx', size: 100, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: 'docx',
    convertStatus: 'done', status: 'ready',
    pages: [
      { page: 1, url: '/api/files/docx-1?as=page&n=1', width: 1239, height: 1752 },
      { page: 2, url: '/api/files/docx-1?as=page&n=2', width: 1239, height: 1752 },
    ],
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

function txtTask(over: Partial<Task> = {}): Task {
  return {
    id: 'txt-1', name: 'hi.txt', size: 100, ext: 'txt', mime: 'text/plain',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'txt',
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

/** Identity mock 翻译结果（每页 sourceText === targetText） */
const DOCX_IDENTITY_PAGES: TranslateResponse = {
  sourceLang: 'zh-CN',
  targetLang: 'en',
  segments: [{ index: 0, source: '你好世界', target: '你好世界' }],
  paragraphBlocks: [{ kind: 'equal', leftText: '你好世界', rightText: '你好世界' }],
  pages: [
    { page: 1, sourceText: '你好世界', targetText: '你好世界', pageW: 1239, pageH: 1752, startLine: 1, endLine: 1,
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
        { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 },
      ],
    },
    { page: 2, sourceText: '第二页', targetText: '第二页', pageW: 1239, pageH: 1752, startLine: 2, endLine: 2,
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
      ],
    },
  ],
  ms: 5,
  meta: { segmentsCount: 1, pagesCount: 2, sourceChars: 7, targetChars: 7, engine: 'identity-mock-v1' },
}

/** IntersectionObserver mock：捕获 callback 供测试触发 */
class MockIO {
  cb: IntersectionObserverCallback
  opts?: IntersectionObserverInit
  observed: Element[] = []
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.cb = cb
    this.opts = opts
  }
  observe(el: Element) {
    this.observed.push(el)
    ;(el as any).__mockObs = this
  }
  unobserve() {}
  disconnect() { this.observed = [] }
  takeRecords() { return [] }
}
;(globalThis as any).IntersectionObserver = MockIO

// jsdom 没实现 URL.createObjectURL
if (typeof URL.createObjectURL !== 'function') {
  let id = 1
  ;(URL as any).createObjectURL = () => `blob:mock/${id++}`
  ;(URL as any).revokeObjectURL = () => {}
}

/** 触发指定 cell 的 IO 进入视口 */
function triggerInView(testId: string) {
  const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement
  if (el) {
    const obs = (el as any).__mockObs as MockIO | undefined
    if (obs) {
      const entry = { target: el, isIntersecting: true, intersectionRatio: 1 } as any
      obs.cb([entry], obs as any)
    }
  }
}

beforeEach(() => {
  localStorage.clear()
  __resetPageRenderCacheForTest()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ============ 1. DOCX → POST /api/inspect/translate 带 strategy='passthrough' ============

describe('TranslationLayout v4.0 — DOCX 任务走 passthrough', () => {
  it('1. DOCX 任务：点 AI 翻译 → POST body 含 strategy="passthrough"', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'idle',
      translateResult: null,
      translateError: null,
    })

    const postCalls: Array<{ url: string; body: any }> = []
    const fetchSpy = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST' && url === '/api/inspect/translate') {
        const body = JSON.parse(init.body)
        postCalls.push({ url, body })
        return { ok: true, status: 200, json: async () => DOCX_IDENTITY_PAGES, text: async () => '' } as any
      }
      // 兜底
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })
    ;(globalThis as any).fetch = fetchSpy

    render(<TranslationLayout />)
    fireEvent.click(screen.getByTestId('translate-ai-btn'))

    await waitFor(() => {
      expect(postCalls.length).toBeGreaterThan(0)
    })
    expect(postCalls[0].body.taskId).toBe('docx-1')
    expect(postCalls[0].body.strategy).toBe('passthrough')
  })

  it('2. txt 任务：点 AI 翻译 → POST body 不含 strategy（默认 synthetic）', async () => {
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'idle',
      translateResult: null,
      translateError: null,
    })

    const postCalls: Array<{ url: string; body: any }> = []
    const fetchSpy = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST' && url === '/api/inspect/translate') {
        const body = JSON.parse(init.body)
        postCalls.push({ url, body })
        return { ok: true, status: 200, json: async () => DOCX_IDENTITY_PAGES, text: async () => '' } as any
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })
    ;(globalThis as any).fetch = fetchSpy

    render(<TranslationLayout />)
    fireEvent.click(screen.getByTestId('translate-ai-btn'))

    await waitFor(() => {
      expect(postCalls.length).toBeGreaterThan(0)
    })
    // txt 走 synthetic 管线（可以是 undefined 或 'synthetic'，当前实现显式传 'synthetic'）
    expect(['synthetic', undefined]).toContain(postCalls[0].body.strategy)
  })

  it('3. DOCX 任务：右 cell 拉取 render-image/render-text URL 都带 strategy=passthrough', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })

    const fetchUrls: string[] = []
    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchUrls.push(url)
      if (url.includes('/render-image')) {
        return {
          ok: true, status: 200,
          headers: { get: (k: string) => ({ 'x-translate-page-w': '1239', 'x-translate-page-h': '1752', 'x-translate-render-ms': '5', 'x-translate-cached': '0' }[k.toLowerCase()] || null) },
          blob: async () => ({ size: 100, type: 'image/png' }),
          text: async () => '',
        } as any
      }
      if (url.includes('/render-text')) {
        return {
          ok: true, status: 200,
          headers: { get: () => null },
          text: async () => `<div class="pdf-text-layer" data-pdfium="6" data-page-w="1239" data-page-h="1752"><span data-tgt-idx="0" data-src-idx="0">你</span><span data-tgt-idx="1" data-src-idx="1">好</span></div>`,
          blob: async () => ({ size: 50 }),
        } as any
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)
    // 触发第 1 页右 cell 进入视口（IO 监听在 translate-tgt-page-1 上）
    await act(async () => {
      triggerInView('translate-tgt-page-1')
    })

    await waitFor(() => {
      const imageCall = fetchUrls.find(u => u.includes('/render-image'))
      expect(imageCall).toBeDefined()
    })
    expect(fetchUrls.some(u => u.includes('/render-image') && u.includes('strategy=passthrough'))).toBe(true)
    expect(fetchUrls.some(u => u.includes('/render-text') && u.includes('strategy=passthrough'))).toBe(true)
  })

  it('4. DOCX 任务：右 cell 渲染 → 文字层是 data-pdfium="6"（v6 fullDoc charMap）', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })

    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/render-image')) {
        return {
          ok: true, status: 200,
          headers: { get: (k: string) => ({ 'x-translate-page-w': '1239', 'x-translate-page-h': '1752', 'x-translate-render-ms': '5', 'x-translate-cached': '0' }[k.toLowerCase()] || null) },
          blob: async () => ({ size: 100, type: 'image/png' }),
          text: async () => '',
        } as any
      }
      if (url.includes('/render-text')) {
        const html = `<div class="pdf-text-layer" data-pdfium="6" data-page-w="1239" data-page-h="1752"><span data-tgt-idx="0" data-src-idx="0">你</span><span data-tgt-idx="1" data-src-idx="1">好</span><span data-tgt-idx="2" data-src-idx="2">世</span><span data-tgt-idx="3" data-src-idx="3">界</span></div>`
        return {
          ok: true, status: 200,
          headers: { get: () => null },
          text: async () => html,
          blob: async () => ({ size: 50 }),
        } as any
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)
    await act(async () => {
      triggerInView('translate-tgt-page-1')
    })

    await waitFor(() => {
      // wrapper .pdf-text-layer 包含 inner .pdf-text-layer；找含 data-pdfium 的那个
      const layer = document.querySelector('[data-testid="translate-tgt-page-1"] [data-pdfium]')
      expect(layer).toBeTruthy()
      expect(layer?.getAttribute('data-pdfium')).toBe('6')
    })
  })

  it('5. hover 右 cell span（data-src-idx="2"）→ setHoveredSrcIdx 触发联动', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })

    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/render-image')) {
        return {
          ok: true, status: 200,
          headers: { get: (k: string) => ({ 'x-translate-page-w': '1239', 'x-translate-page-h': '1752', 'x-translate-render-ms': '5', 'x-translate-cached': '0' }[k.toLowerCase()] || null) },
          blob: async () => ({ size: 100, type: 'image/png' }),
          text: async () => '',
        } as any
      }
      if (url.includes('/render-text')) {
        const html = `<div class="pdf-text-layer" data-pdfium="6" data-page-w="1239" data-page-h="1752"><span data-tgt-idx="0" data-src-idx="0">你</span><span data-tgt-idx="1" data-src-idx="1">好</span><span data-tgt-idx="2" data-src-idx="2">世</span><span data-tgt-idx="3" data-src-idx="3">界</span></div>`
        return {
          ok: true, status: 200,
          headers: { get: () => null },
          text: async () => html,
          blob: async () => ({ size: 50 }),
        } as any
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)
    await act(async () => {
      triggerInView('translate-tgt-page-1')
    })

    // 等渲染完成
    await waitFor(() => {
      const span = document.querySelector('[data-testid="translate-tgt-page-1"] span[data-src-idx="2"]')
      expect(span).toBeTruthy()
    })
    const span = document.querySelector('[data-testid="translate-tgt-page-1"] span[data-src-idx="2"]') as HTMLElement
    await act(async () => {
      fireEvent.mouseOver(span)
    })

    // v5.0：hover 通过 DOM .is-hover class 高亮，不再用 data-hovered-src-idx 属性
    // hover span 后，对应 data-src-idx="2" 的 span 应有 .is-hover
    const hovered = document.querySelectorAll('[data-src-idx="2"].is-hover')
    expect(hovered.length).toBeGreaterThanOrEqual(1)
  })

  it('6. 切 lang → 清缓存 + 重新拉取（验证 strategy 一致）', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })

    const fetchUrls: string[] = []
    ;(globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchUrls.push(url)
      if (url.includes('/render-image')) {
        return {
          ok: true, status: 200,
          headers: { get: (k: string) => ({ 'x-translate-page-w': '1239', 'x-translate-page-h': '1752', 'x-translate-render-ms': '5', 'x-translate-cached': '0' }[k.toLowerCase()] || null) },
          blob: async () => ({ size: 100, type: 'image/png' }),
          text: async () => '',
        } as any
      }
      if (url.includes('/render-text')) {
        return {
          ok: true, status: 200,
          headers: { get: () => null },
          text: async () => `<div class="pdf-text-layer" data-pdfium="6" data-page-w="1239" data-page-h="1752"><span></span></div>`,
          blob: async () => ({ size: 50 }),
        } as any
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any
    })

    render(<TranslationLayout />)
    // 第一次：触发第 1 页（IO 监听在 translate-tgt-page-1 上）
    await act(async () => {
      triggerInView('translate-tgt-page-1')
    })
    await waitFor(() => {
      expect(fetchUrls.some(u => u.includes('/render-image') && u.includes('strategy=passthrough'))).toBe(true)
    })
    const urlCountBefore = fetchUrls.filter(u => u.includes('/render-image')).length

    // 切到 ja
    await act(async () => {
      fireEvent.change(screen.getByTestId('translate-target-lang'), { target: { value: 'ja' } })
    })

    // 重新触发（同 cell，因为之前 cache 已被 useEffect 清掉）
    await act(async () => {
      triggerInView('translate-tgt-page-1')
    })
    // 应该有新的 render-image 请求（缓存清后重新拉）
    await waitFor(() => {
      const after = fetchUrls.filter(u => u.includes('/render-image')).length
      expect(after).toBeGreaterThan(urlCountBefore)
    })
    // 新请求仍带 strategy=passthrough（DOCX 任务不变）
    expect(fetchUrls.some(u => u.includes('/render-image') && u.includes('strategy=passthrough'))).toBe(true)
  })
})