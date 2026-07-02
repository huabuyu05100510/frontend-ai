// TranslationLayout v4.1.3 — 默认 zoom 自适应（fit container width）
// 模型：claude-sonnet-4-6
//
// 背景：DOCX 任务 pageW=991，左右 cell 共 1982px + 19px padding
//      默认 scale=1 时超过常见 1280/1600 视口 → 横向溢出 → 滚动不联动
// v4.1.3：
//   - 初始 scale = clamp(containerW / (pageW * 2 + gap), 0.4, 1.0)
//   - toolbar 加「适应宽度」按钮：一键回到容器宽度的 95%
//   - 横向溢出：.ttl-pages-scroll overflow-x: auto（可拖）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { TranslationLayout, __resetPageRenderCacheForTest } from '../src/inspect/TranslationLayout'
import { useStore } from '../src/store'
import type { Task, TranslateResponse } from '../src/types'

function docxTask(over: Partial<Task> = {}): Task {
  return {
    id: 'docx-1', name: 'test.docx', size: 100, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: 'docx',
    convertStatus: 'done', status: 'ready',
    pages: [
      { page: 1, url: '/api/files/docx-1?as=page&n=1', width: 991, height: 1401 },
    ],
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

const DOCX_IDENTITY_PAGES: TranslateResponse = {
  sourceLang: 'zh-CN', targetLang: 'en',
  segments: [{ index: 0, source: '你好', target: '你好' }],
  paragraphBlocks: [{ kind: 'equal', leftText: '你好', rightText: '你好' }],
  pages: [{
    page: 1, sourceText: '你好', targetText: '你好',
    pageW: 991, pageH: 1401, startLine: 1, endLine: 1,
    charMap: [
      { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
      { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
    ],
  }],
  ms: 1,
  meta: { segmentsCount: 1, pagesCount: 1, sourceChars: 2, targetChars: 2, engine: 'identity-mock-v1' },
}

class MockIO {
  cb: IntersectionObserverCallback
  observed: Element[] = []
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) {
    this.observed.push(el)
    ;(el as any).__mockObs = this
  }
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

beforeEach(() => {
  localStorage.clear()
  __resetPageRenderCacheForTest()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TranslationLayout v5.0 — 默认 zoom 自适应面板宽度', () => {
  // v5.0：双面板架构，fit-width 基于单面板宽度 (panelW * 0.92 / pageW)
  it('1. 面板宽 640px + pageW=991 → 初始 scale ≈ 0.59（640 * 0.92 / 991）', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })
    ;(globalThis as any).fetch = vi.fn().mockImplementation(async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      blob: async () => ({ size: 100 }),
      text: async () => '<div data-pdfium="6" data-page-w="991" data-page-h="1401"></div>',
    }))

    // mock 原文面板宽度（单面板 640px ≈ 视口 1280 / 2）
    const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get() {
        if (this.getAttribute('data-testid') === 'translate-src-scroll') return 640
        return 0
      },
      configurable: true,
    })

    try {
      render(<TranslationLayout />)
      const zoomLabel = screen.getByTestId('translate-zoom')
      const scale = Number(zoomLabel.textContent!.replace('%', '')) / 100
      // 640 * 0.92 / 991 ≈ 0.594
      expect(scale).toBeGreaterThan(0.5)
      expect(scale).toBeLessThan(0.75)
    } finally {
      if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth)
    }
  })

  it('2. 面板宽 1200px → 初始 scale = 1.0（不放大）', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      blob: async () => ({ size: 100 }),
      text: async () => '',
    })

    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      // panelW=1200 → (1200*0.92)/991 ≈ 1.11 → clamped to 1.0
      get() { return this.getAttribute('data-testid') === 'translate-src-scroll' ? 1200 : 0 },
      configurable: true,
    })

    try {
      render(<TranslationLayout />)
      const zoomLabel = screen.getByTestId('translate-zoom')
      const scale = Number(zoomLabel.textContent!.replace('%', '')) / 100
      expect(scale).toBe(1.0)
    } finally {
      if (orig) Object.defineProperty(HTMLElement.prototype, 'clientWidth', orig)
    }
  })

  it('3. 点 toolbar「适应宽度」按钮 → scale 重算为面板宽度的 92%', async () => {
    useStore.setState({
      translateSource: docxTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: DOCX_IDENTITY_PAGES,
      translateError: null,
    })
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      blob: async () => ({ size: 100 }),
      text: async () => '',
    })

    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get() { return this.getAttribute('data-testid') === 'translate-src-scroll' ? 640 : 0 },
      configurable: true,
    })

    try {
      render(<TranslationLayout />)
      // 先手动放大
      const zoomIn = screen.getByLabelText('放大')
      for (let i = 0; i < 8; i++) fireEvent.click(zoomIn)
      let scale = Number(screen.getByTestId('translate-zoom').textContent!.replace('%', '')) / 100
      expect(scale).toBeGreaterThan(1.3)

      // 点「适应宽度」
      const fitBtn = screen.getByTestId('translate-fit-width')
      fireEvent.click(fitBtn)
      scale = Number(screen.getByTestId('translate-zoom').textContent!.replace('%', '')) / 100
      // 640 * 0.92 / 991 ≈ 0.594
      expect(scale).toBeGreaterThan(0.4)
      expect(scale).toBeLessThan(0.75)
    } finally {
      if (orig) Object.defineProperty(HTMLElement.prototype, 'clientWidth', orig)
    }
  })
})
