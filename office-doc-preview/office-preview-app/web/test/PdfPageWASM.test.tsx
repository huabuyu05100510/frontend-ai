// PdfPageWASM 单页 WASM 渲染组件测试 (v2 — Worker + Coordinator)
// 模型：claude-sonnet-4-6
//
// v2 关键设计点：
//   1. 所有 WASM 操作通过 Coordinator → Web Worker
//   2. Coordinator 可被 mock 替换
//   3. 渐进式渲染：低清 → 全清
//   4. 保持组件 Props 接口向后兼容
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

// ============ Mock Coordinator ============
const mockRelease = vi.fn()
const mockRequestRender = vi.fn()
const mockRequestTextExtract = vi.fn().mockResolvedValue({
  pageNum: 1, positions: new Float32Array(0), chars: '', pageW: 595, pageH: 842,
})

const mockOpenDocument = vi.fn().mockResolvedValue({
  docId: 1,
  pageCount: 3,
  pageSizes: [{ w: 595, h: 842 }, { w: 595, h: 842 }, { w: 595, h: 842 }],
  release: mockRelease,
})

vi.mock('../src/previewers/pdf-wasm/coordinator', () => ({
  getCoordinator: () => ({
    openDocument: mockOpenDocument,
    requestRender: mockRequestRender,
    cancelPageRender: vi.fn(),
    requestTextExtract: mockRequestTextExtract,
    evictDocBitmaps: vi.fn(),
    destroy: vi.fn(),
    get status() { return { state: 'ready', documents: 0, bitmapEntries: 0, bitmapCacheMB: 0, queueDepth: 0 } },
  }),
  __resetCoordinatorForTest: () => {
    mockOpenDocument.mockClear()
    mockRequestRender.mockClear()
    mockRelease.mockClear()
  },
}))

// ============ Mock text-layer-builder ============
vi.mock('../src/previewers/pdf-wasm/text-layer-builder', () => ({
  buildTextLayerFromCharBoxes: () => '',
  buildTextLayerDiv: () => '',
}))

// jsdom polyfill
if (typeof URL.createObjectURL !== 'function') {
  ;(URL as any).createObjectURL = () => 'blob:mock/1'
  ;(URL as any).revokeObjectURL = () => {}
}

// ============ 引入被测组件 ============
import { PdfPageWASM } from '../src/previewers/PdfPageWASM'
import { __resetCoordinatorForTest } from '../src/previewers/pdf-wasm/coordinator'

beforeEach(async () => {
  __resetCoordinatorForTest()
  mockOpenDocument.mockClear()
  mockRequestRender.mockClear()
  mockRelease.mockClear()
  mockRequestTextExtract.mockClear()
})

afterEach(() => cleanup())

describe('PdfPageWASM v2 — 单页 WASM 渲染组件（Worker + Coordinator）', () => {
  it('smoke：mount 不抛异常', async () => {
    const { container } = render(
      <PdfPageWASM url="/api/files/test.pdf" pageNum={1} />
    )
    expect(container).toBeTruthy()
  })

  it('挂载后调用 coordinator.openDocument', async () => {
    render(
      <PdfPageWASM url="/api/files/test.pdf" pageNum={1} />
    )
    await waitFor(() => {
      expect(mockOpenDocument).toHaveBeenCalledWith('/api/files/test.pdf')
    }, { timeout: 3000 })
  })

  it('openDocument 后调用 coordinator.requestRender', async () => {
    render(
      <PdfPageWASM url="/api/files/test.pdf" pageNum={1} />
    )
    await waitFor(() => {
      expect(mockRequestRender).toHaveBeenCalled()
    }, { timeout: 3000 })
    // requestRender 的三个参数
    const call = mockRequestRender.mock.calls[0]
    expect(call[0]).toBe(1) // docId
    expect(call[1]).toBe(1) // pageNum
    expect(typeof call[2]).toBe('number') // scale
  })

  it('unmount 后调用 release', async () => {
    const { unmount } = render(
      <PdfPageWASM url="/api/files/test.pdf" pageNum={1} />
    )
    await waitFor(() => {
      expect(mockOpenDocument).toHaveBeenCalled()
    }, { timeout: 3000 })
    unmount()
    await waitFor(() => {
      expect(mockRelease).toHaveBeenCalled()
    })
  })

  it('加日志：mount 时打印 [pdf-page-wasm-v2]', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    render(<PdfPageWASM url="/api/files/log.pdf" pageNum={1} />)
    await waitFor(() => {
      expect(logSpy.mock.calls.some(c => /\[pdf-page-wasm-v2\]/.test(String(c[0])))).toBe(true)
    })
    logSpy.mockRestore()
  })

  it('serverTextUrl prop 被接受（不因新增 props 报错）', async () => {
    const { container } = render(
      <PdfPageWASM
        url="/api/files/test.pdf"
        pageNum={1}
        serverTextUrl="/api/files/test?as=text&n=1"
      />
    )
    expect(container).toBeTruthy()
  })
})