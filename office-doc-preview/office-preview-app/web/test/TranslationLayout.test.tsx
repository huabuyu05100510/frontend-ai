// TranslationLayout 组件测试 — 双语阅读模式（按页对照 + 右栏 on-demand 渲染）
// 模型：claude-sonnet-4-6
//
// 设计目标（对标 翻译狗 / 讯飞设计稿）：
//   1. 顶部状态栏：源文件 + 语言选择 + AI 翻译 + 缩放 + 下载
//   2. 左侧缩略图栏：每页一个缩略卡，点击跳转
//   3. 主区域：每页一对（左原文 / 右译文）
//   4. 翻页控制：首页/上/下/末页 + 当前页码
//   5. 底部信息条：段数/页数/字符数/耗时
//   6. 状态：空态/加载/错误
//   7. 右栏 on-demand 渲染：进入视口才拉取（DOCX→PDF→PDFium 管线）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { TranslationLayout } from '../src/inspect/TranslationLayout'
import { useStore } from '../src/store'
import type { Task, TranslateResponse } from '../src/types'

function txtTask(over: Partial<Task> = {}): Task {
  return {
    id: 'src-1', name: '原文.txt', size: 100, ext: 'txt', mime: 'text/plain',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'txt',
    convertStatus: 'done', status: 'ready',
    createdAt: Date.now(), updatedAt: Date.now(),
    ...over,
  } as Task
}

/** 构造 3 页翻译结果（每页 30 行） */
const SAMPLE_PAGES_TRANSLATE: TranslateResponse = {
  sourceLang: 'zh-CN',
  targetLang: 'en',
  segments: [
    { index: 0, source: '第一段。', target: '[en] 第一段。' },
    { index: 1, source: '第二段。', target: '[en] 第二段。' },
  ],
  paragraphBlocks: [],
  pages: [
    {
      page: 1, sourceText: '第 1 页内容\n第 1 页第二行',
      targetText: '[en] 第 1 页内容\n[en] 第 1 页第二行',
      pageW: 794, pageH: 1123, startLine: 1, endLine: 2,
    },
    {
      page: 2, sourceText: '第 2 页内容',
      targetText: '[en] 第 2 页内容',
      pageW: 794, pageH: 1123, startLine: 3, endLine: 3,
    },
    {
      page: 3, sourceText: '第 3 页内容',
      targetText: '[en] 第 3 页内容',
      pageW: 794, pageH: 1123, startLine: 4, endLine: 4,
    },
  ],
  ms: 12,
  meta: { segmentsCount: 2, pagesCount: 3, sourceChars: 30, targetChars: 50, engine: 'mock-v1' },
}

// ============ IntersectionObserver mock ============
// 进入视口 → isIntersecting=true
// 默认 NOT in-view（让 test 显式触发），并支持手动 flush
type IOMockEntry = { target: Element; isIntersecting: boolean; intersectionRatio: number }
let pendingIOEntries: IOMockEntry[] = []

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  observed: Element[] = []
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.callback = cb
    this.options = opts
  }
  observe(el: Element) {
    this.observed.push(el)
    // 默认 NOT in-view（除非该 element 有 data-in-view="1" 标记）
    if ((el as HTMLElement).dataset?.inView === '1') {
      pendingIOEntries.push({
        target: el,
        isIntersecting: true,
        intersectionRatio: 1,
      })
    } else {
      pendingIOEntries.push({
        target: el,
        isIntersecting: false,
        intersectionRatio: 0,
      })
    }
  }
  unobserve() { /* noop */ }
  disconnect() { this.observed = [] }
  takeRecords() { return [] }
  static flush(entries?: IOMockEntry[]) {
    const list = entries || pendingIOEntries
    pendingIOEntries = []
    return list
  }
}
;(globalThis as any).IntersectionObserver = MockIntersectionObserver
;(globalThis as any).flushIntersectionObservers = (entries?: IOMockEntry[]) => {
  const list = MockIntersectionObserver.flush(entries)
  // 找到所有 obs 实例并调用其 callback
  // 简化：把 list 推入 pending，由组件 useEffect 触发
  // 由于每个组件都有独立 obs，这里采用「标记 + flush」机制
  // 直接调用每个 cell 关联的 callback
  list.forEach(entry => {
    const el = entry.target as HTMLElement
    // 触发 cell 的 observer（通过全局 mock observers 列表）
    const obs = (el as any).__mockObs
    if (obs) obs.callback([entry], obs)
  })
}

// 让 IntersectionObserver 暴露其 callback 便于测试触发
const originalObserve = MockIntersectionObserver.prototype.observe
MockIntersectionObserver.prototype.observe = function(el: Element) {
  originalObserve.call(this, el)
  ;(el as any).__mockObs = this
}

// jsdom 没实现 URL.createObjectURL / revokeObjectURL — polyfill
if (typeof URL.createObjectURL !== 'function') {
  let nextObjId = 1
  ;(URL as any).createObjectURL = (_obj: any) => `blob:mock/${nextObjId++}`
  ;(URL as any).revokeObjectURL = (_url: string) => { /* noop */ }
}

function mockFetchTranslate(impl: (url: string, init?: any) => Promise<any>) {
  return vi.fn().mockImplementation(impl) as any
}

/** Mock /api/inspect/translate/render-image + render-text 响应（成功） */
function mockRenderSuccess() {
  return mockFetchTranslate(async (url: string) => {
    if (url.includes('/render-image')) {
      // 模拟 PNG 响应（最小 1×1 PNG）
      const png = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xDE,
        0, 0, 0, 12, 0x49, 0x44, 0x41, 0x54,
        8, 0x57, 0x63, 0xF8, 0xCF, 0xC0, 0, 0, 0, 3, 0, 1, 0x5B, 0x6E, 0xF9, 0x37,
        0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ])
      const headersMap = new Map<string, string>([
        ['x-translate-page', '1'],
        ['x-translate-cached', '0'],
        ['x-translate-render-ms', '15'],
        ['x-translate-page-w', '1239'],
        ['x-translate-page-h', '1752'],
      ])
      return {
        ok: true,
        status: 200,
        headers: { get: (k: string) => headersMap.get(k.toLowerCase()) || null },
        blob: async () => ({ size: png.length, type: 'image/png' }),
        text: async () => '',
      } as any
    }
    if (url.includes('/render-text')) {
      const html = `<div class="pdf-text-layer" data-pdfium="4" data-page-w="1239.00" data-page-h="1752.00"><span style="position:absolute;left:120px;top:124px">[en] 第 1 页内容</span><span style="position:absolute;left:120px;top:160px">[en] 第 1 页第二行</span></div>`
      return {
        ok: true,
        status: 200,
        headers: { get: (_k: string) => null },
        text: async () => html,
        blob: async () => ({ size: html.length, type: 'text/html' }),
      } as any
    }
    return { ok: true, status: 200, text: async () => 'x' } as any
  })
}

/** 触发指定 cell 的 IntersectionObserver 进入视口 */
function triggerInView(testId: string) {
  const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement
  if (el) {
    const obs = (el as any).__mockObs as MockIntersectionObserver | undefined
    if (obs) {
      const entry = {
        target: el,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) },
        intersectionRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) },
        rootBounds: null,
        time: Date.now(),
      } as unknown as IntersectionObserverEntry
      obs.callback([entry], obs as unknown as IntersectionObserver)
    }
  }
}

// ============ 状态：空/加载/错误 ============

describe('TranslationLayout — 空态/加载/错误', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'idle',
      translateResult: null,
      translateError: null,
    })
    global.fetch = mockFetchTranslate(async () => ({ ok: true, status: 200, text: async () => 'x' } as any))
  })
  afterEach(() => cleanup())

  it('渲染源文件名 + 源/目标语言选择 + AI 翻译按钮', async () => {
    render(<TranslationLayout />)
    await waitFor(() => {
      expect(screen.getByText('原文.txt')).toBeTruthy()
    })
    expect(screen.getByTestId('translate-source-lang')).toBeTruthy()
    expect(screen.getByTestId('translate-target-lang')).toBeTruthy()
    expect(screen.getByRole('button', { name: /AI 翻译/ })).toBeTruthy()
  })

  it('【v4.2】mount 时 status=idle → 自动触发一次 /api/inspect/translate（无需手点 AI 翻译）', async () => {
    const fetchMock = mockFetchTranslate(async (url: string) => {
      if (url.startsWith('/o')) return { ok: true, status: 200, text: async () => '原文' } as any
      return { ok: true, status: 200, json: async () => SAMPLE_PAGES_TRANSLATE } as any
    })
    global.fetch = fetchMock
    render(<TranslationLayout />)
    // mount 即触发，不需要任何点击
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]: any) => u === '/api/inspect/translate')
      expect(calls.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('status=loading：显示「翻译中…」+ 进度文案', () => {
    useStore.setState({ translateStatus: 'loading' })
    render(<TranslationLayout />)
    expect(screen.getByTestId('translate-loading')).toBeTruthy()
    expect(screen.getByText(/翻译中/)).toBeTruthy()
  })

  it('status=error：显示错误信息 + 重试按钮', () => {
    useStore.setState({ translateStatus: 'error', translateError: '服务端 500' })
    render(<TranslationLayout />)
    expect(screen.getByTestId('translate-error')).toBeTruthy()
    expect(screen.getByText(/服务端 500/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy()
  })
})

// ============ 渲染：按页双语阅读（结构） ============

describe('TranslationLayout — 按页双语阅读结构', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: SAMPLE_PAGES_TRANSLATE,
      translateError: null,
    })
    global.fetch = mockRenderSuccess()
  })
  afterEach(() => cleanup())

  it('ready 态：渲染左侧缩略图栏 + 主区域', () => {
    render(<TranslationLayout />)
    expect(screen.getByTestId('translate-thumbs')).toBeTruthy()
    expect(screen.getByTestId('translate-body')).toBeTruthy()
  })

  it('缩略图数量 = 页数（3 个 thumb 卡片）', () => {
    const { container } = render(<TranslationLayout />)
    const thumbs = container.querySelectorAll('[data-testid^="thumb-"]')
    expect(thumbs.length).toBe(3)
  })

  it('缩略图含 data-page 与正确页码', () => {
    const { container } = render(<TranslationLayout />)
    expect(container.querySelector('[data-testid="thumb-1"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="thumb-2"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="thumb-3"]')).toBeTruthy()
  })

  it('页面网格：每页一对 cell（左原文 / 右译文），共 3 行', () => {
    // v5.0：双面板结构 — 原文面板 3 项 + 译文面板 3 项
    const { container } = render(<TranslationLayout />)
    const srcItems = container.querySelectorAll('.ttl-src-grid .ttl-page-item')
    const tgtItems = container.querySelectorAll('.ttl-tgt-grid .ttl-page-item')
    expect(srcItems.length).toBe(3)
    expect(tgtItems.length).toBe(3)
  })

  it('每行包含左侧 cell + 右侧 cell + 中分隔', () => {
    // v5.0：双面板结构 — 原文 cell 在左面板，译文 cell 在右面板，中间有竖向分割线
    const { container } = render(<TranslationLayout />)
    const leftCell = container.querySelector('.ttl-page-cell[data-side="left"][data-page="1"]') as HTMLElement
    const rightCell = container.querySelector('.ttl-page-cell[data-side="right"][data-page="1"]') as HTMLElement
    expect(leftCell).toBeTruthy()
    expect(rightCell).toBeTruthy()
    expect(container.querySelector('.ttl-panels-divider')).toBeTruthy()
  })

  it('左侧 cell 渲染 sourceText（原文）', () => {
    const { container } = render(<TranslationLayout />)
    const firstLeft = container.querySelector('.ttl-page-cell[data-side="left"][data-page="1"]') as HTMLElement
    expect(firstLeft.textContent).toContain('第 1 页内容')
    expect(firstLeft.textContent).toContain('第 1 页第二行')
  })

  it('右栏 cell 在未进入视口前显示 loading 占位（on-demand 渲染）', () => {
    const { container } = render(<TranslationLayout />)
    const firstRight = container.querySelector('.ttl-page-cell[data-side="right"][data-page="1"]') as HTMLElement
    // data-testid="translate-tgt-page-1" 是 TranslatedPage 容器
    const tgtPage = firstRight.querySelector('[data-testid="translate-tgt-page-1"]') as HTMLElement
    expect(tgtPage).toBeTruthy()
    expect(tgtPage.getAttribute('data-status')).toBe('pending')
  })

  it('页码徽章：每页 cell 上有「1」「2」「3」徽章', () => {
    const { container } = render(<TranslationLayout />)
    const nums = container.querySelectorAll('.ttl-page-num')
    expect(nums.length).toBeGreaterThanOrEqual(3)
  })

  it('底部信息条：页数 + 段数 + 字符数 + 耗时 + 引擎', () => {
    render(<TranslationLayout />)
    const footer = screen.getByTestId('translate-footer')
    expect(footer.textContent).toContain('3 页')
    expect(footer.textContent).toContain('2 段')
    expect(footer.textContent).toContain('30 字符')
    expect(footer.textContent).toContain('ms')
    expect(footer.textContent).toContain('mock-v1')
  })
})

// ============ 渲染：右栏 on-demand ============

describe('TranslationLayout — 右栏 on-demand 渲染（DOCX→PDF→PDFium）', () => {
  beforeEach(async () => {
    localStorage.clear()
    // 清模块级 pageRenderCache（避免上一个测试的渲染残留到下一个）
    const { __resetPageRenderCacheForTest } = await import('../src/inspect/TranslationLayout')
    __resetPageRenderCacheForTest()
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: SAMPLE_PAGES_TRANSLATE,
      translateError: null,
    })
  })
  afterEach(() => cleanup())

  it('右栏 cell 进入视口 → 触发 /render-image + /render-text 拉取', async () => {
    const fetchMock = mockRenderSuccess()
    global.fetch = fetchMock
    render(<TranslationLayout />)

    // 触发 cell 1 的 IntersectionObserver
    triggerInView('translate-tgt-page-1')

    await waitFor(() => {
      const imgCalls = fetchMock.mock.calls.filter(([u]: any) =>
        typeof u === 'string' && u.includes('/render-image')
      )
      const textCalls = fetchMock.mock.calls.filter(([u]: any) =>
        typeof u === 'string' && u.includes('/render-text')
      )
      expect(imgCalls.length).toBeGreaterThanOrEqual(1)
      expect(textCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('拉取完成后右栏 cell 显示 img + pdf-text-layer', async () => {
    global.fetch = mockRenderSuccess()
    render(<TranslationLayout />)

    triggerInView('translate-tgt-page-1')

    await waitFor(() => {
      const firstRight = document.querySelector('.ttl-page-cell[data-side="right"][data-page="1"]') as HTMLElement
      const tgtPage = firstRight.querySelector('[data-testid="translate-tgt-page-1"]') as HTMLElement
      expect(tgtPage.getAttribute('data-status')).toBe('ready')
    })

    const firstRight = document.querySelector('.ttl-page-cell[data-side="right"][data-page="1"]') as HTMLElement
    const img = firstRight.querySelector('img.ttl-page-img')
    const textLayer = firstRight.querySelector('.pdf-text-layer')
    expect(img).toBeTruthy()
    expect(textLayer).toBeTruthy()
  })

  it('渲染请求带 taskId + page + targetLang 参数', async () => {
    const fetchMock = mockRenderSuccess()
    global.fetch = fetchMock
    render(<TranslationLayout />)

    triggerInView('translate-tgt-page-1')

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]: any) => typeof u === 'string' && u.includes('/render-image'))
      expect(calls.length).toBeGreaterThanOrEqual(1)
    })

    const call = fetchMock.mock.calls.find(([u]: any) => typeof u === 'string' && u.includes('/render-image'))!
    const url = call[0]
    expect(url).toContain('taskId=src-1')
    expect(url).toContain('page=1')
    expect(url).toContain('targetLang=en')
    expect(url).toContain('sourceLang=zh-CN')
  })

  it('右栏加载失败 → 显示 error 态 + 重试按钮', async () => {
    const fetchMock = mockFetchTranslate(async (url: string) => {
      if (url.includes('/render-image') || url.includes('/render-text')) {
        return { ok: false, status: 500, text: async () => 'boom', blob: async () => new Blob() } as any
      }
      return { ok: true, status: 200, text: async () => 'x' } as any
    })
    global.fetch = fetchMock
    render(<TranslationLayout />)

    triggerInView('translate-tgt-page-1')

    await waitFor(() => {
      const firstRight = document.querySelector('.ttl-page-cell[data-side="right"][data-page="1"]') as HTMLElement
      const tgtPage = firstRight.querySelector('[data-testid="translate-tgt-page-1"]') as HTMLElement
      expect(tgtPage.getAttribute('data-status')).toBe('error')
    })

    const firstRight = document.querySelector('.ttl-page-cell[data-side="right"][data-page="1"]') as HTMLElement
    const errEl = firstRight.querySelector('.ttl-page-error')
    expect(errEl?.textContent).toContain('渲染失败')
    const retryBtn = firstRight.querySelector('button.btn-mini')
    expect(retryBtn?.textContent).toContain('重试')
  })

  it('切换目标语言 → 触发右栏重新渲染（清缓存）', async () => {
    const fetchMock = mockRenderSuccess()
    global.fetch = fetchMock
    render(<TranslationLayout />)

    // 第一次进入视口 → 拉取 en 渲染
    triggerInView('translate-tgt-page-1')
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]: any) =>
        typeof u === 'string' && u.includes('/render-image')
      )
      expect(calls.length).toBe(1)
    })

    // 切换目标语言 → ja
    const select = screen.getByTestId('translate-target-lang') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ja' } })

    // 状态被清空（v4.2：自动重新触发后变为 loading）
    await waitFor(() => {
      expect(['idle', 'loading']).toContain(useStore.getState().translateStatus)
    })
  })

  it('【双滚动容器】原文面板 (.ttl-src-scroll) 和译文面板 (.ttl-tgt-scroll) 各含 3 个页面项', () => {
    // v5.0：双滚动条架构 — 两个独立 overflow-y: scroll 容器，JS 联动同步
    useStore.setState({ translateStatus: 'ready', translateResult: SAMPLE_PAGES_TRANSLATE })
    const { container } = render(<TranslationLayout />)
    const srcScroll = container.querySelector('.ttl-src-scroll') as HTMLElement
    const tgtScroll = container.querySelector('.ttl-tgt-scroll') as HTMLElement
    expect(srcScroll).toBeTruthy()
    expect(tgtScroll).toBeTruthy()
    const srcItems = srcScroll.querySelectorAll('.ttl-page-item')
    const tgtItems = tgtScroll.querySelectorAll('.ttl-page-item')
    expect(srcItems.length).toBe(3)
    expect(tgtItems.length).toBe(3)
    // 左右 cell 宽度相同（同一页）
    const leftCells = Array.from(srcScroll.querySelectorAll('.ttl-page-cell[data-side="left"]')) as HTMLElement[]
    const rightCells = Array.from(tgtScroll.querySelectorAll('.ttl-page-cell[data-side="right"]')) as HTMLElement[]
    leftCells.forEach((l, i) => {
      expect(l.style.width).toBe(rightCells[i].style.width)
    })
  })

  it('【PDF 任务】源文件有 pages 时，左侧 cell 渲染 PDF 图像而非文本', () => {
    const pdfTask = txtTask({
      ext: 'pdf',
      pages: [
        { page: 1, url: '/api/files/src-1?as=page&n=1', width: 794, height: 1123 },
        { page: 2, url: '/api/files/src-1?as=page&n=2', width: 794, height: 1123 },
        { page: 3, url: '/api/files/src-1?as=page&n=3', width: 794, height: 1123 },
      ],
    })
    useStore.setState({
      translateSource: pdfTask,
      translateStatus: 'ready',
      translateResult: SAMPLE_PAGES_TRANSLATE,
    })
    const { container } = render(<TranslationLayout />)
    const firstLeft = container.querySelector('.ttl-page-cell[data-side="left"][data-page="1"]') as HTMLElement
    const img = firstLeft.querySelector('img.ttl-page-img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/api/files/src-1?as=page&n=1')
  })
})

// ============ 交互：翻页 + 缩放 + AI 翻译触发 ============

describe('TranslationLayout — 交互', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'idle',
      translateResult: null,
      translateError: null,
    })
  })
  afterEach(() => cleanup())

  it('点击「重新翻译」→ 再次触发 /api/inspect/translate（mount 已自动触发一次，此处为第 2 次）', async () => {
    const fetchMock = mockFetchTranslate(async (url: string, init?: any) => {
      if (url.startsWith('/o')) {
        return { ok: true, status: 200, text: async () => '原文 A。\n原文 B。' } as any
      }
      return { ok: true, status: 200, json: async () => SAMPLE_PAGES_TRANSLATE } as any
    })
    global.fetch = fetchMock

    render(<TranslationLayout />)
    // 等待 mount 自动触发完成（第 1 次）
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]: any) => u === '/api/inspect/translate')
      expect(calls.length).toBe(1)
    })
    // 等到 ready 后再点击
    await waitFor(() => {
      expect(useStore.getState().translateStatus).toBe('ready')
    })
    const aiBtn = screen.getByRole('button', { name: /重新翻译|AI 翻译/ })
    fireEvent.click(aiBtn)

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]: any) => u === '/api/inspect/translate')
      expect(calls.length).toBe(2)
    })
    const lastCall = fetchMock.mock.calls.filter(([u]: any) => u === '/api/inspect/translate').pop()!
    const init = lastCall[1] as any
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ sourceLang: 'zh-CN', targetLang: 'en' })
    expect(body.taskId).toBe('src-1')
  })

  it('切换目标语言 → store 状态更新', () => {
    render(<TranslationLayout />)
    const select = screen.getByTestId('translate-target-lang') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ja' } })
    expect(useStore.getState().translateTargetLang).toBe('ja')
  })

  it('切换源语言 → store 状态更新', () => {
    render(<TranslationLayout />)
    const select = screen.getByTestId('translate-source-lang') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'en' } })
    expect(useStore.getState().translateSourceLang).toBe('en')
  })

  it('AI 翻译失败 → status=error + 显示错误信息（v4.2：mount 自动触发，无需点击）', async () => {
    const fetchMock = mockFetchTranslate(async (url: string) => {
      if (url.startsWith('/o')) {
        return { ok: true, status: 200, text: async () => '原文。' } as any
      }
      return { ok: false, status: 500, text: async () => 'server boom' } as any
    })
    global.fetch = fetchMock
    render(<TranslationLayout />)

    await waitFor(() => {
      expect(useStore.getState().translateStatus).toBe('error')
    })
    expect(useStore.getState().translateError).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('translate-error')).toBeTruthy()
    })
  })

  it('ready 态：翻页控制按钮存在（首页/上/下/末页）', () => {
    useStore.setState({ translateStatus: 'ready', translateResult: SAMPLE_PAGES_TRANSLATE })
    render(<TranslationLayout />)
    expect(screen.getByTestId('translate-pager')).toBeTruthy()
    expect(screen.getByRole('button', { name: '首页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '上一页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '末页' })).toBeTruthy()
  })

  it('ready 态：翻页信息显示「1 / 3」', () => {
    useStore.setState({ translateStatus: 'ready', translateResult: SAMPLE_PAGES_TRANSLATE })
    render(<TranslationLayout />)
    expect(screen.getByTestId('translate-pager-info').textContent).toContain('1 / 3')
  })

  it('点击缩略图：调用 scrollIntoView', () => {
    useStore.setState({ translateStatus: 'ready', translateResult: SAMPLE_PAGES_TRANSLATE })
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock
    render(<TranslationLayout />)
    const thumb3 = screen.getByTestId('thumb-3')
    fireEvent.click(thumb3)
    expect(scrollIntoViewMock).toHaveBeenCalled()
  })

  it('缩放按钮：+/- 改变 zoom 文本', () => {
    useStore.setState({ translateStatus: 'ready', translateResult: SAMPLE_PAGES_TRANSLATE })
    render(<TranslationLayout />)
    const zoom = screen.getByTestId('translate-zoom')
    const before = zoom.textContent
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(zoom.textContent).not.toBe(before)
    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
  })

  it('切换语言后清空旧结果并自动重新翻译（v4.2：mount 自动重触发）', async () => {
    useStore.setState({ translateStatus: 'ready', translateResult: SAMPLE_PAGES_TRANSLATE })
    global.fetch = mockFetchTranslate(async (url: string) => {
      if (url.startsWith('/o')) return { ok: true, status: 200, text: async () => '原文' } as any
      return { ok: true, status: 200, json: async () => SAMPLE_PAGES_TRANSLATE } as any
    })
    render(<TranslationLayout />)
    const select = screen.getByTestId('translate-target-lang') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ja' } })
    // 旧结果清空
    await waitFor(() => {
      expect(useStore.getState().translateResult).toBeNull()
    })
  })

  it('【键盘】AI 翻译按钮存在（v4.2：mount 自动触发，可能处于 loading）', async () => {
    render(<TranslationLayout />)
    const btn = screen.getByTestId('translate-ai-btn')
    expect(btn).toBeTruthy()
    // mount 后自动触发：loading 或 ready/error 后显示「AI 翻译」或「重新翻译」
    await waitFor(() => {
      expect(useStore.getState().translateStatus).toMatch(/^(loading|ready|error)$/)
    })
  })
})

// ============ v4.2 格式选择器（PDF / 图片+文字 / WASM） ============

describe('TranslationLayout — 格式选择器', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: SAMPLE_PAGES_TRANSLATE,
      translateError: null,
      translateRenderMode: 'images',
    })
    global.fetch = mockFetchTranslate(async () => ({ ok: true, status: 200, text: async () => 'x' } as any))
  })
  afterEach(() => cleanup())

  it('工具栏渲染三个格式按钮：PDF / 图片+文字 / WASM', () => {
    render(<TranslationLayout />)
    expect(screen.getByTestId('translate-mode-pdf')).toBeTruthy()
    expect(screen.getByTestId('translate-mode-images')).toBeTruthy()
    expect(screen.getByTestId('translate-mode-wasm')).toBeTruthy()
  })

  it('默认 images 模式高亮（on）', () => {
    render(<TranslationLayout />)
    const images = screen.getByTestId('translate-mode-images')
    expect(images.classList.contains('on')).toBe(true)
  })

  it('点击 PDF 按钮 → store.translateRenderMode = pdf', () => {
    render(<TranslationLayout />)
    fireEvent.click(screen.getByTestId('translate-mode-pdf'))
    expect(useStore.getState().translateRenderMode).toBe('pdf')
  })

  it('点击 WASM 按钮 → store.translateRenderMode = wasm', () => {
    render(<TranslationLayout />)
    fireEvent.click(screen.getByTestId('translate-mode-wasm'))
    expect(useStore.getState().translateRenderMode).toBe('wasm')
  })

  it('【txt 文件】PDF / WASM 按钮 disabled（无源 PDF）', () => {
    useStore.setState({ translateSource: txtTask({ ext: 'txt', previewUrl: null, previewExt: 'txt' }) })
    render(<TranslationLayout />)
    expect((screen.getByTestId('translate-mode-pdf') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('translate-mode-wasm') as HTMLButtonElement).disabled).toBe(true)
    // images 始终可用
    expect((screen.getByTestId('translate-mode-images') as HTMLButtonElement).disabled).toBe(false)
  })

  it('【docx 文件 + 有 previewUrl】PDF / WASM 按钮可用', () => {
    useStore.setState({
      translateSource: txtTask({
        ext: 'docx', previewUrl: '/api/files/src-1/preview.pdf', previewExt: 'pdf',
      }),
    })
    render(<TranslationLayout />)
    expect((screen.getByTestId('translate-mode-pdf') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('translate-mode-wasm') as HTMLButtonElement).disabled).toBe(false)
  })

  it('【v5.1】PDF 模式废弃 embed → 左侧（原文）改用 SourcePage（图片 + 文字层），无 embed 元素', () => {
    // v5.1：embed 模式在双栏视图中显示整本 PDF（三页合一），已废弃。
    // pdf 模式现在等同于 images 模式（server 图片 + pdfium 文字层）。
    useStore.setState({
      translateSource: txtTask({
        ext: 'docx', previewUrl: '/api/files/src-1/preview.pdf', previewExt: 'pdf',
      }),
      translateRenderMode: 'pdf',
    })
    const { container } = render(<TranslationLayout />)
    // 不再有 embed 元素
    expect(container.querySelectorAll('embed').length).toBe(0)
    // 源面板仍有 3 个页面 item
    const srcItems = container.querySelectorAll('.ttl-src-grid .ttl-page-item')
    expect(srcItems.length).toBe(3)
    // 每个 item 含 ttl-page-paper（SourcePage 包装）
    expect(srcItems[0].querySelector('.ttl-page-paper')).toBeTruthy()
  })

  it('【v5.1】PDF 模式：源面板按页渲染，每页 data-page 正确（单页不叠整本文档）', () => {
    useStore.setState({
      translateSource: txtTask({
        ext: 'docx', previewUrl: '/api/files/src-1/preview.pdf', previewExt: 'pdf',
      }),
      translateRenderMode: 'pdf',
    })
    const { container } = render(<TranslationLayout />)
    const srcItems = container.querySelectorAll('.ttl-src-grid .ttl-page-item')
    expect(srcItems.length).toBe(3)
    // 每个 item 的 data-page 与序号对应
    expect((srcItems[0] as HTMLElement).dataset.page).toBe('1')
    expect((srcItems[1] as HTMLElement).dataset.page).toBe('2')
    expect((srcItems[2] as HTMLElement).dataset.page).toBe('3')
  })

  it('【v5.1】PDF 模式：右侧译文仍走 server images（无 embed，无 wasm slot）', () => {
    useStore.setState({
      translateSource: txtTask({
        ext: 'docx', previewUrl: '/api/files/src-1/preview.pdf', previewExt: 'pdf',
      }),
      translateRenderMode: 'pdf',
    })
    const { container } = render(<TranslationLayout />)
    // 目标面板也无 embed 元素
    const tgtItems = container.querySelectorAll('.ttl-tgt-grid .ttl-page-item')
    expect(tgtItems.length).toBe(3)
    expect(container.querySelectorAll('embed').length).toBe(0)
  })

  it('【v4.3】WASM 模式：左侧（原文）cell 渲染 PdfPageWASM，右侧（译文）不渲染 WASM（server images）', () => {
    useStore.setState({
      translateSource: txtTask({
        ext: 'docx', previewUrl: '/api/files/src-1/preview.pdf', previewExt: 'pdf',
      }),
      translateRenderMode: 'wasm',
    })
    const { container } = render(<TranslationLayout />)
    // v5.0：原文面板 3 项，每项左 cell 含 .pdf-page-wasm
    const srcItems = container.querySelectorAll('.ttl-src-grid .ttl-page-item')
    expect(srcItems.length).toBe(3)
    const leftWasmSlots = Array.from(srcItems).map(item =>
      item.querySelector('.ttl-page-cell[data-side="left"] .pdf-page-wasm')
    )
    expect(leftWasmSlots[0]).toBeTruthy()
    expect(leftWasmSlots[1]).toBeTruthy()
    expect(leftWasmSlots[2]).toBeTruthy()
    // 每个 slot 暴露 data-page 对应页号
    expect(leftWasmSlots[0]?.getAttribute('data-page')).toBe('1')
    expect(leftWasmSlots[2]?.getAttribute('data-page')).toBe('3')
    // 不应渲染整本文档查看器（避免 PdfPreviewWASM 的 .pdf-root）
    expect(container.querySelectorAll('.pdf-root').length).toBe(0)
    // 右侧不应有 .pdf-page-wasm（右侧始终 server images）
    const tgtWasm = container.querySelectorAll('.ttl-tgt-grid .pdf-page-wasm')
    expect(tgtWasm.length).toBe(0)
  })

  it('【v5.0】PDF / WASM / 图片模式：共用双面板结构（ttl-src-scroll + ttl-tgt-scroll）', () => {
    useStore.setState({
      translateSource: txtTask({
        ext: 'docx', previewUrl: '/api/files/src-1/preview.pdf', previewExt: 'pdf',
      }),
      translateRenderMode: 'pdf',
    })
    const { container } = render(<TranslationLayout />)
    // v5.0：双面板结构，左右各含 3 个 page-item
    const srcGrid = container.querySelector('.ttl-src-grid')
    const tgtGrid = container.querySelector('.ttl-tgt-grid')
    expect(srcGrid).toBeTruthy()
    expect(tgtGrid).toBeTruthy()
    // 面板分隔线
    expect(container.querySelector('.ttl-panels-divider')).toBeTruthy()
    // 所有 page-item 有 data-page 对应页号
    const srcItems = Array.from(srcGrid!.querySelectorAll('.ttl-page-item'))
    expect(srcItems[0].getAttribute('data-page')).toBe('1')
    expect(srcItems[2].getAttribute('data-page')).toBe('3')
  })
})

// ============ 性能 ============

describe('TranslationLayout — 性能', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({
      translateSource: txtTask(),
      translateSourceLang: 'zh-CN',
      translateTargetLang: 'en',
      translateStatus: 'ready',
      translateResult: SAMPLE_PAGES_TRANSLATE,
      translateError: null,
    })
    global.fetch = mockFetchTranslate(async () => ({ ok: true, status: 200, text: async () => 'x' } as any))
  })
  afterEach(() => cleanup())

  it('3 页翻译结果初次渲染 < 100ms', () => {
    const t0 = performance.now()
    const { unmount } = render(<TranslationLayout />)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(100)
    unmount()
  })
})
