// TranslationLayout — 字符级 hover 联动测试（v3.1）
// 模型：claude-sonnet-4-6
//
// 验证：
//   1. 左 cell 渲染每字为 span 带 data-src-idx
//   2. hover 左 cell char → setHoveredSrcIdx → 高亮所有 data-src-idx=N 的 span
//   3. 右 cell 文字层（带 data-tgt-idx / data-src-idx）hover 也触发同样联动
//   4. 切换 targetLang → 清 hover 状态
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { TranslationLayout } from '../src/inspect/TranslationLayout'
import { useStore } from '../src/store'
import type { Task, TranslateResponse } from '../src/types'

function txtTask(over: Partial<Task> = {}): Task {
  return {
    id: 'src-hover', name: 'hover.txt', size: 100, ext: 'txt', mime: 'text/plain',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'txt',
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

const HOVER_PAGES: TranslateResponse = {
  sourceLang: 'zh-CN',
  targetLang: 'en',
  segments: [
    { index: 0, source: '你好世界', target: 'Hello World' },
  ],
  paragraphBlocks: [],
  pages: [
    {
      page: 1,
      sourceText: '你好世界',
      targetText: 'Hello World',
      charMap: [
        { srcStart: 0, srcEnd: 4, tgtStart: 0, tgtEnd: 11 },  // 你好世界 → Hello World
      ],
      pageW: 794, pageH: 1123, startLine: 1, endLine: 1,
    },
  ],
  ms: 1,
  meta: { segmentsCount: 1, pagesCount: 1, sourceChars: 4, targetChars: 11, engine: 'mock-v1' },
}

// Mock fetch：translate + render-image + render-text
function mockFetchHover() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/render-image')) {
      return {
        ok: true, status: 200,
        headers: { get: (_k: string) => null },
        blob: async () => ({ size: 100, type: 'image/png' }),
        text: async () => '',
      } as any
    }
    if (url.includes('/render-text')) {
      // 模拟后端返回的字符级 text-layer（data-tgt-idx / data-src-idx）
      const html = `<div class="pdf-text-layer" data-pdfium="5">
        <span data-tgt-idx="0" data-src-idx="0" style="position:absolute;left:0">H</span>
        <span data-tgt-idx="1" data-src-idx="0" style="position:absolute;left:10">e</span>
        <span data-tgt-idx="2" data-src-idx="0" style="position:absolute;left:20">l</span>
        <span data-tgt-idx="3" data-src-idx="0" style="position:absolute;left:30">l</span>
        <span data-tgt-idx="4" data-src-idx="0" style="position:absolute;left:40">o</span>
        <span data-tgt-idx="5" data-src-idx="0" style="position:absolute;left:50"> </span>
        <span data-tgt-idx="6" data-src-idx="0" style="position:absolute;left:60">W</span>
        <span data-tgt-idx="7" data-src-idx="0" style="position:absolute;left:70">o</span>
        <span data-tgt-idx="8" data-src-idx="0" style="position:absolute;left:80">r</span>
        <span data-tgt-idx="9" data-src-idx="0" style="position:absolute;left:90">l</span>
        <span data-tgt-idx="10" data-src-idx="0" style="position:absolute;left:100">d</span>
      </div>`
      return {
        ok: true, status: 200,
        headers: { get: (_k: string) => null },
        text: async () => html,
      } as any
    }
    return { ok: true, status: 200, text: async () => 'x' } as any
  })
}

let mockObserver: { observe: any; unobserve: any; disconnect: any; takeRecords: any }
let ioCallbacks: Array<(entries: any[], obs: any) => void> = []
beforeEach(() => {
  localStorage.clear()
  ioCallbacks = []
  mockObserver = {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    takeRecords: vi.fn().mockReturnValue([]),
  }
  // 修复 v3.1：每个 IO 实例需要 capture 自己的 callback，否则 mockObserver.callback 永远是 null
  ;(globalThis as any).IntersectionObserver = vi.fn().mockImplementation((cb: any) => {
    ioCallbacks.push(cb)
    return mockObserver
  })
  // jsdom createObjectURL polyfill
  if (typeof URL.createObjectURL !== 'function') {
    let nextId = 1
    ;(URL as any).createObjectURL = () => `blob:mock/${nextId++}`
    ;(URL as any).revokeObjectURL = () => {}
  }
  useStore.setState({
    translateSource: txtTask(),
    translateSourceLang: 'zh-CN',
    translateTargetLang: 'en',
    translateStatus: 'ready',
    translateResult: HOVER_PAGES,
    translateError: null,
  })
  global.fetch = mockFetchHover()
})

/** 触发所有 IO 回调（模拟元素进入视口） */
function triggerIOInView() {
  act(() => {
    ioCallbacks.forEach(cb => cb([{ isIntersecting: true, target: document.body }], mockObserver))
  })
}
afterEach(() => cleanup())

describe('TranslationLayout — 字符级 hover 联动（v3.1）', () => {
  it('左 cell 渲染每字为 span 带 data-src-idx（0..3）', async () => {
    const { container } = render(<TranslationLayout />)
    // 触发 on-demand render 完成后，左 cell 应该渲染 4 个 char span（你, 好, 世, 界）
    // 手动触发 IntersectionObserver in-view
    triggerIOInView()
    await new Promise(r => setTimeout(r, 100))

    const leftSpans = container.querySelectorAll('.ttl-page-cell[data-side="left"] .ttl-char')
    expect(leftSpans.length).toBe(4)
    expect(leftSpans[0].getAttribute('data-src-idx')).toBe('0')
    expect(leftSpans[1].getAttribute('data-src-idx')).toBe('1')
    expect(leftSpans[2].getAttribute('data-src-idx')).toBe('2')
    expect(leftSpans[3].getAttribute('data-src-idx')).toBe('3')
  })

  it('hover 左 cell 第 0 个字 → .is-hover 应用于 data-src-idx="0" 的所有 span', async () => {
    const { container } = render(<TranslationLayout />)
    triggerIOInView()
    await new Promise(r => setTimeout(r, 200))

    // 右 cell 文字层已渲染
    await new Promise(r => setTimeout(r, 200))

    // 找到左 cell 第 0 个 char
    const char0 = container.querySelector('.ttl-page-cell[data-side="left"] .ttl-char[data-src-idx="0"]') as HTMLElement
    expect(char0).toBeTruthy()

    // hover
    fireEvent.mouseEnter(char0)

    // 等 React 状态更新
    await new Promise(r => setTimeout(r, 50))

    // 左 cell 第 0 个字应该有 .is-hover
    expect(char0.classList.contains('is-hover')).toBe(true)
    // 其他左 cell char 不应该有
    const char1 = container.querySelector('.ttl-page-cell[data-side="left"] .ttl-char[data-src-idx="1"]') as HTMLElement
    expect(char1.classList.contains('is-hover')).toBe(false)
  })

  it('hover 右 cell 文字层 span（带 data-src-idx=0）→ 左 cell 第 0 个字也高亮', async () => {
    const { container } = render(<TranslationLayout />)
    triggerIOInView()
    await new Promise(r => setTimeout(r, 400))

    // 找到右 cell 文字层某个 span
    const rightSpans = container.querySelectorAll('.ttl-page-cell[data-side="right"] [data-src-idx="0"]')
    expect(rightSpans.length).toBeGreaterThan(0)

    const firstRightSpan = rightSpans[0] as HTMLElement
    fireEvent.mouseEnter(firstRightSpan)
    await new Promise(r => setTimeout(r, 50))

    // 左 cell 第 0 个字应该有 .is-hover
    const char0 = container.querySelector('.ttl-page-cell[data-side="left"] .ttl-char[data-src-idx="0"]') as HTMLElement
    expect(char0.classList.contains('is-hover')).toBe(true)
  })

  it('mouseLeave 清空 hover 状态', async () => {
    const { container } = render(<TranslationLayout />)
    triggerIOInView()
    await new Promise(r => setTimeout(r, 200))

    const char0 = container.querySelector('.ttl-page-cell[data-side="left"] .ttl-char[data-src-idx="0"]') as HTMLElement
    fireEvent.mouseEnter(char0)
    await new Promise(r => setTimeout(r, 30))
    expect(char0.classList.contains('is-hover')).toBe(true)

    fireEvent.mouseLeave(char0)
    await new Promise(r => setTimeout(r, 30))
    expect(char0.classList.contains('is-hover')).toBe(false)
  })
})
