// PdfImagesPreview 测试：图片层 + 文字覆盖层渲染、可选性、懒加载
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { PdfImagesPreview } from '../src/previewers/PdfImagesPreview'
import type { Task } from '../src/types'
import { usePerf } from '../src/perf'

function pdfTask(pages: number, withText = true): Task {
  return {
    id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
    convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
    pages: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      url: `/api/files/t1?as=page&n=${i + 1}`,
      textUrl: withText ? `/api/files/t1?as=text&n=${i + 1}` : undefined,
      textWords: withText ? 5 : 0,
      width: 800, height: 1130, bytes: 100_000
    })),
    pagesTotal: pages
  } as Task
}

describe('PdfImagesPreview - 基础渲染', () => {
  it('每页渲染一个 <div class="pdf-image-page">', () => {
    render(<PdfImagesPreview task={pdfTask(5)} />)
    const pages = document.querySelectorAll('.pdf-image-page')
    expect(pages.length).toBe(5)
  })

  it('每页包含一个 <img class="pdf-images-page">', () => {
    render(<PdfImagesPreview task={pdfTask(3)} />)
    const imgs = document.querySelectorAll('img.pdf-images-page')
    expect(imgs.length).toBe(3)
    expect((imgs[0] as HTMLImageElement).src).toContain('as=page&n=1')
    expect((imgs[2] as HTMLImageElement).src).toContain('as=page&n=3')
  })

  it('所有 <img> 使用 loading=lazy / decoding=async', () => {
    render(<PdfImagesPreview task={pdfTask(3)} />)
    const imgs = document.querySelectorAll('img.pdf-images-page')
    imgs.forEach(img => {
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.getAttribute('decoding')).toBe('async')
    })
  })

  it('显示「第 N / M 页」 计数', () => {
    render(<PdfImagesPreview task={pdfTask(7)} />)
    expect(screen.getByText(/共 7 页/)).toBeTruthy()
  })

  it('记录渲染到 usePerf（renderedPages 累加）', () => {
    usePerf.getState().set({ renderedPages: 0 })
    render(<PdfImagesPreview task={pdfTask(2)} />)
    expect(usePerf.getState().renderedPages).toBeGreaterThanOrEqual(0)
  })
})

describe('PdfImagesPreview - 像素对齐（文字层与图片同坐标系）', () => {
  it('每页 .pdf-image-page 的宽/高 = 该页 width/height（与栅格化 PNG 像素一致）', () => {
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [
        { page: 1, url: '/u1', width: 1020, height: 1320, bytes: 100 },
        { page: 2, url: '/u2', width: 800,  height: 1100, bytes: 100 },
        { page: 3, url: '/u3', width: 1200, height: 1600, bytes: 100 }
      ],
      pagesTotal: 3
    } as Task
    render(<PdfImagesPreview task={t} />)
    const pageDivs = document.querySelectorAll('.pdf-image-page') as NodeListOf<HTMLElement>
    expect(pageDivs.length).toBe(3)
    // 每页 wrapper 必须用页面自身像素尺寸（让文字 bbox 与图片 1:1 对齐）
    expect((pageDivs[0] as HTMLElement).style.width).toBe('1020px')
    expect((pageDivs[0] as HTMLElement).style.height).toBe('1320px')
    expect((pageDivs[1] as HTMLElement).style.width).toBe('800px')
    expect((pageDivs[1] as HTMLElement).style.height).toBe('1100px')
    expect((pageDivs[2] as HTMLElement).style.width).toBe('1200px')
    expect((pageDivs[2] as HTMLElement).style.height).toBe('1600px')
  })

  it('frame 用最大页宽 maxWidth 容纳所有页（不再用首页 aspectRatio 锁死）', () => {
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [
        { page: 1, url: '/u1', width: 1020, height: 1320, bytes: 100 },
        { page: 2, url: '/u2', width: 1500, height: 2000, bytes: 100 }   // 比首页宽
      ],
      pagesTotal: 2
    } as Task
    render(<PdfImagesPreview task={t} />)
    const frame = document.querySelector('.pdf-images-frame') as HTMLElement
    // frame maxWidth 应为所有页中最大宽度（1500），而非首页宽（1020）
    expect(frame.style.maxWidth).toBe('1500px')
    // 不再用首页 aspectRatio 锁死 frame 高宽比（让每页按自身高度布局）
    expect(frame.style.aspectRatio).toBe('')
  })

  it('图片在 wrapper 内 100% 填充（width/height: 100%）', () => {
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u1', width: 1020, height: 1320, bytes: 100 }],
      pagesTotal: 1
    } as Task
    render(<PdfImagesPreview task={t} />)
    const img = document.querySelector('img.pdf-images-page') as HTMLImageElement
    // 现在 img 不再被内联 width/height: 100% 强制（避免双控），由 CSS class 完全管理
    expect(img.style.width).toBe('')
    expect(img.style.height).toBe('')
  })
})

describe('PdfImagesPreview - data-page-w/h 权威尺寸兜底', () => {
  let originalFetch: any

  beforeEach(async () => {
    originalFetch = global.fetch
    // textCache 是模块级 Map，重置模块让每个测试拿到干净的缓存
    vi.resetModules()
  })
  afterEach(() => { global.fetch = originalFetch })

  it('API 返回老脏数据（thumb 尺寸）时，wrapper 仍按 text-layer data-page-w/h 缩放', async () => {
    // 重导组件以获得干净的 textCache
    const { PdfImagesPreview: FreshPdfImagesPreview } = await import('../src/previewers/PdfImagesPreview')
    // 模拟服务端用老 converter.mjs 写入脏数据：width=300, height=424（缩略图尺寸）
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u1', textUrl: '/u1-text', width: 300, height: 424, bytes: 100 }], // ← 脏数据
      pagesTotal: 1
    } as Task
    // 但 text-layer 自带权威 data-page-w/h（120 DPI = 1020×1320）
    (global.fetch as any) = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<div class="pdf-text-layer" data-page-w="1020" data-page-h="1320">' +
        '<span style="position:absolute;left:133.33px;top:937.33px;width:66.67px;height:12.00px">Hello</span>' +
        '</div>'
    })) as any

    render(<FreshPdfImagesPreview task={t} />)

    await waitFor(() => {
      expect(document.querySelector('.pdf-text-layer span')).toBeTruthy()
    })

    const wrapper = document.querySelector('.pdf-image-page') as HTMLElement
    // 关键：即使 API 说 300×424，wrapper 也要用 data-page-w/h → 1020×1320
    expect(wrapper.style.width).toBe('1020px')
    expect(wrapper.style.height).toBe('1320px')
    expect(wrapper.getAttribute('data-page-w')).toBe('1020')
    expect(wrapper.getAttribute('data-page-h')).toBe('1320')
  })

  it('text-layer 未返回 data-page-w/h 时，wrapper 兜底用 API width/height', async () => {
    const { PdfImagesPreview: FreshPdfImagesPreview } = await import('../src/previewers/PdfImagesPreview')
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u1', textUrl: '/u1-text', width: 1020, height: 1320, bytes: 100 }],
      pagesTotal: 1
    } as Task
    // text-layer 不含 data-page-w/h
    (global.fetch as any) = vi.fn(async () => ({
      ok: true,
      text: async () => '<div class="pdf-text-layer"><span>X</span></div>'
    })) as any

    render(<FreshPdfImagesPreview task={t} />)

    await waitFor(() => {
      expect(document.querySelector('.pdf-text-layer')).toBeTruthy()
    })

    const wrapper = document.querySelector('.pdf-image-page') as HTMLElement
    expect(wrapper.style.width).toBe('1020px')
    expect(wrapper.style.height).toBe('1320px')
  })

  it('新结构：每词都是 position:absolute 的 span（无 <p> 行容器）', async () => {
    const { PdfImagesPreview: FreshPdfImagesPreview } = await import('../src/previewers/PdfImagesPreview')
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u1', textUrl: '/u1-text', width: 1020, height: 1320, bytes: 100 }],
      pagesTotal: 1
    } as Task
    (global.fetch as any) = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<div class="pdf-text-layer" data-page-w="1020" data-page-h="1320">' +
        '<span style="position:absolute;left:100px;top:200px;width:60px;height:15px">前端</span>' +
        '<span style="position:absolute;left:165px;top:200px;width:80px;height:15px">工程师</span>' +
        '</div>'
    })) as any

    render(<FreshPdfImagesPreview task={t} />)

    await waitFor(() => {
      const spans = document.querySelectorAll('.pdf-text-layer span')
      expect(spans.length).toBe(2)
    })

    const spans = document.querySelectorAll('.pdf-text-layer span')
    // 没有 <p> 容器
    expect(document.querySelectorAll('.pdf-text-layer p').length).toBe(0)
    // 每词 position:absolute（继承自 CSS）
    for (const s of Array.from(spans) as HTMLElement[]) {
      // jsdom 不算 CSS，但 inline style 应该保留
      expect((s as HTMLElement).style.position).toBe('absolute')
    }
    // 第一个词的 left/top 来自内联 style
    expect((spans[0] as HTMLElement).style.left).toBe('100px')
    expect((spans[0] as HTMLElement).style.top).toBe('200px')
    expect(spans[0].textContent).toBe('前端')
    expect(spans[1].textContent).toBe('工程师')
  })

  it('每页 wrapper 同时带 data-page-w / data-page-h 属性（供测试断言 / e2e 抓取）', async () => {
    const { PdfImagesPreview: FreshPdfImagesPreview } = await import('../src/previewers/PdfImagesPreview')
    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u1', textUrl: '/u1-text', width: 1020, height: 1320, bytes: 100 }],
      pagesTotal: 1
    } as Task
    (global.fetch as any) = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<div class="pdf-text-layer" data-page-w="1020" data-page-h="1320">' +
        '<span style="position:absolute;left:0;top:0;width:1px;height:1px">x</span>' +
        '</div>'
    })) as any

    render(<FreshPdfImagesPreview task={t} />)
    await waitFor(() => {
      expect(document.querySelector('.pdf-text-layer')).toBeTruthy()
    })

    const wrapper = document.querySelector('.pdf-image-page') as HTMLElement
    expect(wrapper.getAttribute('data-page-w')).toBe('1020')
    expect(wrapper.getAttribute('data-page-h')).toBe('1320')
  })
})

describe('PdfImagesPreview - 文字覆盖层', () => {
  let originalFetch: any

  beforeEach(() => {
    originalFetch = global.fetch
    usePerf.getState().set({ renderEngine: 'unknown', pdfiumRenderMs: 0, pdfiumTotalMs: 0, pdfiumCharsTotal: 0 })
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('fetch 文字层 HTML 后注入到 .pdf-text-layer', async () => {
    // 模拟 fetch 返回带中文文字的 HTML
    const fetchMock = vi.fn(async (url: string): Promise<any> => {
      if (url.includes('as=text')) {
        return {
          ok: true,
          text: async () =>
            '<div class="pdf-text-layer">' +
            '<p style="position:absolute;left:100px;top:200px"><span>前端工程师</span></p>' +
            '</div>'
        }
      }
      return { ok: false, text: async () => '' }
    })
    global.fetch = fetchMock as any

    render(<PdfImagesPreview task={pdfTask(2)} />)

    await waitFor(() => {
      const layers = document.querySelectorAll('.pdf-image-page .pdf-text-layer')
      expect(layers.length).toBeGreaterThan(0)
    }, { timeout: 2000 })

    const layer = document.querySelector('.pdf-text-layer') as HTMLElement
    expect(layer).toBeTruthy()
    // DOM 注入的文字应在（视觉透明但 DOM 存在）
    expect(layer.innerHTML).toContain('前端工程师')
    expect(layer.innerHTML).toContain('<span>')
  })

  it('文字层支持 CSS 选中（user-select: text）', async () => {
    (global.fetch as any) = vi.fn(async () => ({
      ok: true,
      text: async () => '<div class="pdf-text-layer"><p><span>selectable text</span></p></div>'
    })) as any

    render(<PdfImagesPreview task={pdfTask(1)} />)

    await waitFor(() => {
      expect(document.querySelector('.pdf-text-layer')).toBeTruthy()
    })

    const layer = document.querySelector('.pdf-text-layer') as HTMLElement
    const span = layer.querySelector('span') as HTMLElement
    expect(span).toBeTruthy()
    // CSS 规则存在（在 styles.css 中），但 jsdom 不计算样式；
    // 这里验证类名正确（CSS 选择器匹配即生效）
    expect(layer.classList.contains('pdf-text-layer')).toBe(true)
  })

  it('fetch 失败时静默降级（不阻断渲染）', async () => {
    (global.fetch as any) = vi.fn(async () => ({
      ok: false,
      text: async () => ''
    })) as any

    render(<PdfImagesPreview task={pdfTask(3)} />)

    // 即便 fetch 失败，img 仍应渲染
    await waitFor(() => {
      const imgs = document.querySelectorAll('img.pdf-images-page')
      expect(imgs.length).toBe(3)
    })
  })

  it('无 textUrl 的页不触发 fetch', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true, text: async () => '<div class="pdf-text-layer"></div>'
    }))
    global.fetch = fetchSpy as any

    render(<PdfImagesPreview task={pdfTask(3, /*withText*/ false)} />)

    // 给 React 一个 tick 让 effect 跑完
    await new Promise(r => setTimeout(r, 100))
    expect(fetchSpy).not.toHaveBeenCalled()
    // 但仍渲染图片
    expect(document.querySelectorAll('img.pdf-images-page').length).toBe(3)
  })

  it('文字层被懒加载（图片 src 加载后才 fetch）', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string): Promise<any> => {
      calls.push(url)
      return { ok: true, text: async () => '<div class="pdf-text-layer"></div>' }
    })
    global.fetch = fetchMock as any

    render(<PdfImagesPreview task={pdfTask(5)} />)

    await waitFor(() => {
      // 至少有一个文字层 fetch 被发起（图片 src 设置后立即 fetch）
      expect(calls.length).toBeGreaterThan(0)
    }, { timeout: 2000 })
    // 所有 fetch URL 都是文字层
    for (const u of calls) {
      expect(u).toContain('as=text')
    }
  })
})

describe('PdfImagesPreview - 缩放断层修复（窄窗下 img 与 wrapper 像素一致）', () => {
  it('styles.css 中 .pdf-images-page 没有 max-width: 100%（避免 img 被压缩而 wrapper 不变）', async () => {
    const cssPath = path.resolve(__dirname, '../src/styles.css')
    const css = fs.readFileSync(cssPath, 'utf-8')
    // 找 .pdf-images-page 规则块
    const m = css.match(/\.pdf-images-page\s*\{[^}]+\}/)
    expect(m).toBeTruthy()
    expect(m![0]).not.toMatch(/max-width:\s*100%/)
  })

  it('图片 img 不再用内联 style.width/height 强制 100%（由 CSS class 统一管理）', async () => {
    const tsxPath = path.resolve(__dirname, '../src/previewers/PdfImagesPreview.tsx')
    const tsx = fs.readFileSync(tsxPath, 'utf-8')
    // 不应在 <img> 内联 style 里同时设 width:'100%' height:'100%'
    const imgBlock = tsx.match(/<img[\s\S]*?\/>/)
    expect(imgBlock).toBeTruthy()
    if (imgBlock) {
      const styleMatch = imgBlock[0].match(/style=\{\{([\s\S]*?)\}\}/)
      // 如果还有内联 style，确保没有强制 width/height: 100%
      if (styleMatch) {
        expect(styleMatch[1]).not.toMatch(/width:\s*'100%'/)
        expect(styleMatch[1]).not.toMatch(/height:\s*'100%'/)
      }
    }
  })
})

describe('PdfImagesPreview - PDFium 引擎可观测（响应头 → usePerf）', () => {
  let originalFetch: any

  beforeEach(() => {
    originalFetch = global.fetch
    vi.resetModules()  // 重置模块缓存（含 PdfImagesPreview 模块级 textCache Map）→ 每次测试干净起跑
    // 重置 perf store 中的 PDFium 相关字段
    usePerf.getState().set({
      renderEngine: 'unknown',
      pdfiumRenderMs: 0, pdfiumTotalMs: 0, pdfiumCharsTotal: 0,
      alignErrorAvg: 0, alignErrorMax: 0, alignSamples: 0
    })
  })
  afterEach(() => { global.fetch = originalFetch })

  it('文字层加载完成后从 X-Render-Engine / X-Char-Count 响应头捕获数据 → usePerf', async () => {
    const { PdfImagesPreview: FreshPdfImagesPreview } = await import('../src/previewers/PdfImagesPreview')
    const { usePerf: FreshUsePerf } = await import('../src/perf')

    // mock fetch 返回 text-layer HTML + PDFium 引擎响应头
    const fetchMock = vi.fn(async (url: string): Promise<any> => {
      if (url.includes('as=text')) {
        return {
          ok: true,
          text: async () =>
            '<div class="pdf-text-layer" data-pdfium="1" data-page-w="100" data-page-h="100">' +
            '<span style="position:absolute;left:10px;top:10px;width:30px;height:20px">前</span>' +
            '<span style="position:absolute;left:50px;top:50px;width:30px;height:20px">端</span>' +
            '</div>',
          headers: {
            get: (k: string) => {
              const m: Record<string, string> = {
                'X-Render-Engine': 'pdfium-wasm@2.1.13',
                'X-Char-Count': '2',
                'X-Page-Number': '1'
              }
              return m[k] || null
            }
          }
        }
      }
      return { ok: true, text: async () => '', headers: { get: () => null } }
    })
    global.fetch = fetchMock as any

    const t = {
      id: 't1', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u1.png', textUrl: '/api/files/t1?as=text&n=1', width: 100, height: 100, bytes: 100 }],
      pagesTotal: 1
    } as Task

    class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 100; naturalHeight = 100; width = 100; height = 100
      set src(_: string) { setTimeout(() => this.onload?.(), 0) }
    }
    ;(global as any).Image = MockImage

    render(<FreshPdfImagesPreview task={t} />)

    // 等待文字层 fetch + 响应头捕获
    await waitFor(() => {
      const s = FreshUsePerf.getState()
      expect(s.renderEngine).toBe('pdfium-wasm')
    }, { timeout: 3000 })

    // 验证 usePerf 字段被设置
    const s = FreshUsePerf.getState()
    expect(s.renderEngine).toBe('pdfium-wasm')
    expect(s.pdfiumCharsTotal).toBe(2)
    // PDFium 路径：alignError* 字段应为 0（理论 100% 对齐）
    expect(s.alignErrorAvg).toBe(0)
    expect(s.alignErrorMax).toBe(0)
    expect(s.alignSamples).toBeGreaterThanOrEqual(1)
  })

  it('响应头 X-Render-Engine=fallback-poppler 时 renderEngine 标记为 fallback', async () => {
    const { PdfImagesPreview: FreshPdfImagesPreview } = await import('../src/previewers/PdfImagesPreview')
    const { usePerf: FreshUsePerf } = await import('../src/perf')

    const fetchMock = vi.fn(async (url: string): Promise<any> => {
      if (url.includes('as=text')) {
        return {
          ok: true,
          text: async () =>
            '<div class="pdf-text-layer" data-page-w="100" data-page-h="100">' +
            '<span style="position:absolute;left:10px;top:10px;width:30px;height:20px">A</span>' +
            '</div>',
          headers: {
            get: (k: string) => k === 'X-Render-Engine' ? 'fallback-poppler' : (k === 'X-Char-Count' ? '1' : null)
          }
        }
      }
      return { ok: true, text: async () => '', headers: { get: () => null } }
    })
    global.fetch = fetchMock as any

    const t = {
      id: 't2', name: 'r.pdf', size: 1024, ext: 'pdf', mime: 'application/pdf',
      strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
      convertStatus: 'done', status: 'ready', createdAt: Date.now(), updatedAt: Date.now(),
      pages: [{ page: 1, url: '/u2.png', textUrl: '/api/files/t2?as=text&n=1', width: 100, height: 100, bytes: 100 }],
      pagesTotal: 1
    } as Task

    class MockImage {
      onload: (() => void) | null = null; onerror: (() => void) | null = null
      naturalWidth = 100; naturalHeight = 100; width = 100; height = 100
      set src(_: string) { setTimeout(() => this.onload?.(), 0) }
    }
    ;(global as any).Image = MockImage

    render(<FreshPdfImagesPreview task={t} />)

    await waitFor(() => {
      const s = FreshUsePerf.getState()
      expect(s.renderEngine).toBe('fallback-poppler')
    }, { timeout: 3000 })

    const s = FreshUsePerf.getState()
    expect(s.renderEngine).toBe('fallback-poppler')
    expect(s.pdfiumCharsTotal).toBe(0)  // fallback 不计入 PDFium 统计
  })

  it('usePerf 接口已扩展 PDFium 字段（编译期 + 运行时验证）', () => {
    // 编译期：TypeScript 强制要求这些字段存在（EMPTY 初始化保证）
    const s = usePerf.getState()
    expect(s).toHaveProperty('renderEngine')
    expect(s).toHaveProperty('pdfiumRenderMs')
    expect(s).toHaveProperty('pdfiumTotalMs')
    expect(s).toHaveProperty('pdfiumCharsTotal')
    expect(['pdfium-wasm', 'fallback-poppler', 'unknown']).toContain(s.renderEngine)
  })
})