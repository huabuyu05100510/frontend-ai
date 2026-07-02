// TranslationLayout v4.1.4 — 复制联动（原文/译文/双语）
// 模型：claude-sonnet-4-6
//
// 背景：业界普遍只支持单边复制（80%），双语带格式复制 = 行业缺口 = 本项目差异化亮点
// v4.1.4：
//   - toolbar 加 3 按钮：复制原文 / 复制译文 / 复制双语
//   - 原文/译文：纯文本（按页换行）
//   - 双语：ClipboardItem(text/html + text/plain) → 粘贴到 Word 表格 / Excel 制表符
//
// 验证：
//   1. 复制原文 → navigator.clipboard.writeText 被调 1 次，body = 原文拼接
//   2. 复制译文 → 同上，但 body = 译文拼接
//   3. 复制双语 → navigator.clipboard.write 被调（ClipboardItem），含 text/html 表格 + text/plain 制表符

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { TranslationLayout, __resetPageRenderCacheForTest } from '../src/inspect/TranslationLayout'
import { useStore } from '../src/store'
import type { Task, TranslateResponse } from '../src/types'

function docxTask(): Task {
  return {
    id: 'docx-1', name: 'test.docx', size: 100, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'convert_pdf', originalUrl: '/o', previewUrl: '/p', previewExt: 'docx',
    convertStatus: 'done', status: 'ready',
    pages: [{ page: 1, url: '/api/files/docx-1?as=page&n=1', width: 991, height: 1401 }],
    createdAt: Date.now(), updatedAt: Date.now(),
  } as Task
}

const DOCX_PAGES: TranslateResponse = {
  sourceLang: 'zh-CN', targetLang: 'en',
  segments: [
    { index: 0, source: '你好世界', target: '[en] 你好世界' },
    { index: 1, source: '第二页', target: '[en] 第二页' },
  ],
  paragraphBlocks: [
    { kind: 'change', leftText: '你好世界', rightText: '[en] 你好世界', charOps: [] },
    { kind: 'change', leftText: '第二页', rightText: '[en] 第二页', charOps: [] },
  ],
  pages: [
    { page: 1, sourceText: '你好世界', targetText: '[en] 你好世界',
      pageW: 991, pageH: 1401, startLine: 1, endLine: 1,
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
        { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 },
      ] },
    { page: 2, sourceText: '第二页', targetText: '[en] 第二页',
      pageW: 991, pageH: 1401, startLine: 2, endLine: 2,
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
      ] },
  ],
  ms: 1,
  meta: { segmentsCount: 2, pagesCount: 2, sourceChars: 7, targetChars: 14, engine: 'mock-v1' },
}

class MockIO {
  cb: IntersectionObserverCallback
  observed: Element[] = []
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) { this.observed.push(el); (el as any).__mockObs = this }
  unobserve() {} disconnect() { this.observed = [] } takeRecords() { return [] }
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
  // mock clipboard
  ;(globalThis as any).__lastWriteText = ''
  ;(globalThis as any).__lastClipboardItem = null
  ;(navigator as any).clipboard = {
    writeText: vi.fn(async (s: string) => { (globalThis as any).__lastWriteText = s }),
    write: vi.fn(async (items: any[]) => {
      const out: any = {}
      for (const it of items) {
        for (const k of Object.keys(it)) {
          // data 是 Blob（原生），text() 可用
          const blob = it[k]
          if (typeof blob.text === 'function') {
            out[k] = await blob.text()
          } else {
            out[k] = ''
          }
        }
      }
      ;(globalThis as any).__lastClipboardItem = out
    }),
  }
  // jsdom 没有 ClipboardItem（或不全）→ 用纯 passthrough 包装
  ;(globalThis as any).ClipboardItem = class ClipboardItemMock {
    private data: Record<string, Blob>
    constructor(data: Record<string, Blob>) {
      this.data = data
    }
    get types() { return Object.keys(this.data) }
    getType(type: string) { return this.data[type] }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TranslationLayout v4.1.4 — 复制联动', () => {
  it('1. 点「复制原文」→ 调 clipboard.writeText，body = 每页 sourceText 用 \\n 连接', async () => {
    useStore.setState({
      translateSource: docxTask(), translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: DOCX_PAGES, translateError: null,
    })
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      blob: async () => ({ size: 100 }), text: async () => '',
    })

    render(<TranslationLayout />)
    const btn = screen.getByTestId('translate-copy-source')
    fireEvent.click(btn)
    await waitFor(() => {
      expect((navigator as any).clipboard.writeText).toHaveBeenCalled()
    })
    expect((globalThis as any).__lastWriteText).toBe('你好世界\n第二页')
  })

  it('2. 点「复制译文」→ 调 clipboard.writeText，body = 每页 targetText 用 \\n 连接', async () => {
    useStore.setState({
      translateSource: docxTask(), translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: DOCX_PAGES, translateError: null,
    })
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      blob: async () => ({ size: 100 }), text: async () => '',
    })

    render(<TranslationLayout />)
    const btn = screen.getByTestId('translate-copy-target')
    fireEvent.click(btn)
    await waitFor(() => {
      expect((navigator as any).clipboard.writeText).toHaveBeenCalled()
    })
    expect((globalThis as any).__lastWriteText).toBe('[en] 你好世界\n[en] 第二页')
  })

  it('3. 点「复制双语」→ 调 clipboard.write，含 text/html (table) + text/plain (制表符)', async () => {
    useStore.setState({
      translateSource: docxTask(), translateSourceLang: 'zh-CN', translateTargetLang: 'en',
      translateStatus: 'ready', translateResult: DOCX_PAGES, translateError: null,
    })
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      blob: async () => ({ size: 100 }), text: async () => '',
    })

    render(<TranslationLayout />)
    const btn = screen.getByTestId('translate-copy-bilingual')
    fireEvent.click(btn)
    await waitFor(() => {
      expect((navigator as any).clipboard.write).toHaveBeenCalled()
    })
    // 直接检查调用参数（生产代码传 ClipboardItem[{'text/html': Blob, 'text/plain': Blob}]）
    const writeArgs = ((navigator as any).clipboard.write as any).mock.calls[0][0]
    expect(writeArgs).toHaveLength(1)
    const item = writeArgs[0]
    expect(item.types).toContain('text/html')
    expect(item.types).toContain('text/plain')
    // 用 FileReader 读 blob（jsdom 兼容）
    const htmlBlob: Blob = item.getType('text/html')
    const plainBlob: Blob = item.getType('text/plain')
    const htmlText = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsText(htmlBlob)
    })
    const plainText = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsText(plainBlob)
    })
    expect(htmlText).toContain('<table')
    expect(htmlText).toContain('border="1"')
    expect(htmlText).toContain('<td>你好世界</td>')
    expect(htmlText).toContain('<td>[en] 你好世界</td>')
    expect(plainText).toContain('你好世界\t[en] 你好世界')
    expect(plainText).toContain('第二页\t[en] 第二页')
  })
})
