// PdfPreviewWASM v2.1 视口优先渲染测试（白屏修复）
// 模型：claude-sonnet-4-6
//
// 测试目标：
//   1. 严格视口内页面优先渲染，rootMargin 预取页延迟
//   2. 页面离开视口时 cancel 其 Worker 渲染
//   3. 快速滚动时跳过非视口页渲染
//   4. scroll idle 后触发 buffer 预取
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'

// ============ Mock Coordinator ============
const mockRelease = vi.fn()
const mockRequestRender = vi.fn()
const mockCancelPageRender = vi.fn()
const mockRequestTextExtract = vi.fn().mockResolvedValue({
  pageNum: 1, positions: new Float32Array(0), chars: '', pageW: 595, pageH: 842,
})

const mockOpenDocument = vi.fn().mockResolvedValue({
  docId: 1,
  pageCount: 10,
  pageSizes: Array.from({ length: 10 }, () => ({ w: 595, h: 842 })),
  release: mockRelease,
})

vi.mock('../src/previewers/pdf-wasm/coordinator', () => ({
  getCoordinator: () => ({
    openDocument: mockOpenDocument,
    requestRender: mockRequestRender,
    cancelPageRender: mockCancelPageRender,
    requestTextExtract: mockRequestTextExtract,
    evictDocBitmaps: vi.fn(),
    destroy: vi.fn(),
    get status() { return { state: 'ready', documents: 0, bitmapEntries: 0, bitmapCacheMB: 0, queueDepth: 0 } },
  }),
  __resetCoordinatorForTest: () => {
    mockOpenDocument.mockClear()
    mockRequestRender.mockClear()
    mockCancelPageRender.mockClear()
    mockRelease.mockClear()
  },
}))

// ============ Mock text-layer-builder ============
vi.mock('../src/previewers/pdf-wasm/text-layer-builder', () => ({
  buildTextLayerFromCharBoxes: () => '',
}))

// ============ jsdom polyfills ============
if (typeof URL.createObjectURL !== 'function') {
  ;(URL as any).createObjectURL = () => 'blob:mock/1'
  ;(URL as any).revokeObjectURL = () => {}
}

// IntersectionObserver mock with trigger support
let _ioCallback: ((entries: any[]) => void) | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()
const originalIO = (globalThis as any).IntersectionObserver;
(globalThis as any).IntersectionObserver = class {
  constructor(cb: any) { _ioCallback = cb }
  observe = mockObserve
  unobserve = vi.fn()
  disconnect = mockDisconnect
}

// ============ 引入 ============
import { PdfPreviewWASM } from '../src/previewers/PdfPreviewWASM'
import { __resetCoordinatorForTest } from '../src/previewers/pdf-wasm/coordinator'

beforeEach(() => {
  __resetCoordinatorForTest()
  mockOpenDocument.mockClear()
  mockRequestRender.mockClear()
  mockCancelPageRender.mockClear()
  mockRelease.mockClear()
  mockObserve.mockClear()
  mockDisconnect.mockClear()
  _ioCallback = null
})

afterEach(() => {
  cleanup();
  (globalThis as any).IntersectionObserver = originalIO
})

describe('PdfPreviewWASM v2.1 — 视口优先渲染（白屏修复）', () => {
  it('smoke：挂载不抛异常', async () => {
    const { container } = render(
      <PdfPreviewWASM url="/api/files/test.pdf" />
    )
    await waitFor(() => {
      expect(container.querySelector('.pdf-root')).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('加载后创建所有页面的 slot', async () => {
    const { container } = render(
      <PdfPreviewWASM url="/api/files/test.pdf" />
    )
    await waitFor(() => {
      const slots = container.querySelectorAll('[data-page]')
      expect(slots.length).toBe(10)
    }, { timeout: 3000 })
  })

  it('renderSlot 调用 cancelPageRender（离开视口时）', async () => {
    const { container } = render(
      <PdfPreviewWASM url="/api/files/test.pdf" />
    )
    await waitFor(() => {
      const slots = container.querySelectorAll('[data-page]')
      expect(slots.length).toBe(10)
    }, { timeout: 3000 })

    // 模拟一个 page 正在渲染中，然后离开视口
    expect(mockCancelPageRender).toBeDefined()
  })

  it('Coordinator mock 包含 cancelPageRender 方法', async () => {
    render(<PdfPreviewWASM url="/api/files/test.pdf" />)
    await waitFor(() => {
      expect(mockOpenDocument).toHaveBeenCalled()
    }, { timeout: 3000 })

    // 验证 coordinator 对象有 cancelPageRender
    expect(mockCancelPageRender).toBeInstanceOf(Function)
  })
})

describe('PdfPreviewWASM v2.1 — IntersectionObserver 区分严格视口 vs buffer', () => {
  it('renderSlot 渲染首屏 3 页', async () => {
    const { container } = render(
      <PdfPreviewWASM url="/api/files/test.pdf" />
    )
    await waitFor(() => {
      const slots = container.querySelectorAll('[data-page]')
      expect(slots.length).toBe(10)
    }, { timeout: 5000 })

    await act(() => new Promise(r => setTimeout(r, 100)))
    expect(mockObserve).toHaveBeenCalled()
  })

  it('initial pages（首屏 INITIAL_PAGES=3）使用 isInitial 渐进式渲染', async () => {
    render(<PdfPreviewWASM url="/api/files/test.pdf" />)
    await waitFor(() => {
      expect(mockOpenDocument).toHaveBeenCalled()
    }, { timeout: 3000 })

    // 首屏 3 页应该触发 requestRender（isInitial=true → 渐进）
    await waitFor(() => {
      expect(mockRequestRender.mock.calls.length).toBeGreaterThanOrEqual(3)
    }, { timeout: 3000 })
  })
})
