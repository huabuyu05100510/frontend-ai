// DualImageColumn — 原文件布局双栏 TDD 测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup, screen } from '@testing-library/react'
import { DualImageColumn } from '../src/inspect/DualImageColumn'
import type { Task, InspectDiffResponse } from '../src/types'

function makeTask(over: { id?: string; name?: string; ext?: string; pages?: any[] } = {}): Task {
  return {
    id: over.id || 't1', name: over.name || 'test.docx', size: 100,
    ext: over.ext || 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'convert_pdf' as const,
    originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  }
}

const PAGES_3: Array<{ page: number; url: string; textUrl?: string; width: number; height: number }> = [
  { page: 0, url: '/page0.png', textUrl: '/text0.html', width: 800, height: 1130 },
  { page: 1, url: '/page1.png', textUrl: '/text1.html', width: 800, height: 1130 },
  { page: 2, url: '/page2.png', textUrl: '/text2.html', width: 800, height: 1130 },
]

// 右侧只有 2 页（不等页数场景）
const PAGES_2: Array<{ page: number; url: string; textUrl?: string; width: number; height: number }> = [
  { page: 0, url: '/r-page0.png', textUrl: '/r-text0.html', width: 800, height: 1130 },
  { page: 1, url: '/r-page1.png', textUrl: '/r-text1.html', width: 800, height: 1130 },
]

const DIFF_WITH_BLOCKS: InspectDiffResponse = {
  ops: [],
  errors: [{ id: 'e1', original: '既', corrected: '继', op: 'change' }],
  hunks: [],
  tokens: [],
  paragraphBlocks: [
    {
      kind: 'change',
      leftText: '前文 既往开来',
      rightText: '前文 继往开来',
      charOps: [
        { op: 'equal', text: '前文 ' },
        { op: 'delete', text: '既' },
        { op: 'insert', text: '继' },
        { op: 'equal', text: '往开来' },
      ],
    },
  ],
  ms: 3,
  meta: { granularity: 'paragraph', leftChars: 7, rightChars: 7, errorCount: 1 },
}

// 模拟 text-layer HTML（PDFium 格式：span 带 style 定位）
const TEXT_HTML_P0 = `<div class="pdf-text-layer" data-pdfium="4" data-page="0"><span style="left:10px;top:20px;width:14px;height:12px">前文 </span><span style="left:24px;top:20px;width:12px;height:12px">既</span><span style="left:36px;top:20px;width:12px;height:12px">往开来</span></div>`

// 右栏 text-layer：含 "继"（插入字）
const TEXT_HTML_RIGHT_P0 = `<div class="pdf-text-layer" data-pdfium="4" data-page="0"><span style="left:10px;top:20px;width:14px;height:12px">前文 </span><span style="left:24px;top:20px;width:12px;height:12px">继</span><span style="left:36px;top:20px;width:12px;height:12px">往开来</span></div>`

describe('DualImageColumn — 原文件布局双栏', () => {
  beforeEach(() => {
    const store = {
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    }
    Object.defineProperty(globalThis, 'localStorage', { value: store, writable: true, configurable: true })
  })
  afterEach(() => cleanup())

  it('渲染 grid 容器和列头', () => {
    const src = makeTask({ pages: PAGES_3 })
    const cmp = makeTask({ id: 't2', name: '改正.docx', pages: PAGES_3 })
    render(<DualImageColumn source={src} compare={cmp} diff={DIFF_WITH_BLOCKS} />)
    expect(screen.getByTestId('dual-image-grid')).toBeTruthy()
    expect(screen.getByTestId('dic-left-hd').textContent).toContain('原文')
    expect(screen.getByTestId('dic-right-hd').textContent).toContain('目标')
  })

  it('渲染左右两侧的页面图片', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/page') || url.includes('/r-page')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
      }
      if (url.includes('/text')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(TEXT_HTML_P0) })
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
    })
    const src = makeTask({ pages: PAGES_3 })
    const cmp = makeTask({ id: 't2', pages: PAGES_3 })
    render(<DualImageColumn source={src} compare={cmp} diff={DIFF_WITH_BLOCKS} />)

    await waitFor(() => {
      const imgs = document.querySelectorAll('.dic-page-cell img')
      // 左右各 3 页 + 列头 2 个 img-like elements
      expect(imgs.length).toBeGreaterThanOrEqual(6)
    })
  })

  it('不等页数时，多出的一侧显示空占位 cell', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('.png') || url.includes('.html')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
    })
    const src = makeTask({ pages: PAGES_3 })   // 3 页
    const cmp = makeTask({ id: 't2', pages: PAGES_2 }) // 2 页
    const { container } = render(<DualImageColumn source={src} compare={cmp} diff={DIFF_WITH_BLOCKS} />)

    await waitFor(() => {
      expect(container).toBeTruthy()
    })
    // 应该有 empty cell（右侧缺第 3 页）
    const emptyCells = container.querySelectorAll('.dic-page-empty')
    expect(emptyCells.length).toBeGreaterThan(0)
  })

  it('无 pages 时显示提示信息', () => {
    const src = makeTask({ pages: [] })
    const cmp = makeTask({ pages: [] })
    render(<DualImageColumn source={src} compare={cmp} diff={null} />)
    expect(document.body.textContent || '').toContain('无')
  })

  it('文字层加载后差异高亮 class 应用到 span 上', async () => {
    // 左/右两侧用不同 textUrl（避免组件内 cache 冲突）
    const PAGES_3_R: Array<{ page: number; url: string; textUrl?: string; width: number; height: number }> = [
      { page: 0, url: '/r-page0.png', textUrl: '/r-text0.html', width: 800, height: 1130 },
      { page: 1, url: '/r-page1.png', textUrl: '/r-text1.html', width: 800, height: 1130 },
      { page: 2, url: '/r-page2.png', textUrl: '/r-text2.html', width: 800, height: 1130 },
    ]
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/r-text')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(TEXT_HTML_RIGHT_P0) })
      }
      if (url.includes('/text')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(TEXT_HTML_P0) })
      }
      if (url.includes('.png')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
    })
    const src = makeTask({ pages: PAGES_3 })
    const cmp = makeTask({ id: 't2', pages: PAGES_3_R })
    render(<DualImageColumn source={src} compare={cmp} diff={DIFF_WITH_BLOCKS} />)

    await waitFor(() => {
      // 文字层 span 应该存在
      const spans = document.querySelectorAll('.dic-page-cell .pdf-text-layer span')
      expect(spans.length).toBeGreaterThan(0)
      // delete 类的 span 应该存在（"既"被标记为删除）
      const delSpans = document.querySelectorAll('.dic-diff-delete')
      expect(delSpans.length).toBeGreaterThan(0)
      // insert 类的 span 应该存在（"继"被标记为插入）
      const insSpans = document.querySelectorAll('.dic-diff-insert')
      expect(insSpans.length).toBeGreaterThan(0)
    })
  })
})
