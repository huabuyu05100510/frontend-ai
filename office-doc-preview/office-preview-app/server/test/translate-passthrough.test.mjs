// translate-render.mjs — v4.0 passthrough 渲染测试
// 模型：claude-sonnet-4-6
//
// v4.0 新增：strategy='passthrough' 跳过 soffice 二次转换
//   - imagePath：源 page.png 路径（router.mjs /api/files?as=page&n=N 服务）
//   - textPath：v6 文字层（global offset charMap）
//
// 与 v3.1 'synthetic' 行为对比：
//   - 'synthetic'：buildTranslatedHtml → soffice → PDF → PDFium
//   - 'passthrough'：直接复用源 page.png + v6 升级文字层

import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'

// ============ Fixtures ============

function makeTask({ ext = 'docx', pages = [] } = {}) {
  return {
    id: 'task-passthrough',
    ext,
    previewExt: ext,
    pages,
  }
}

function makePage({ idx = 1, text = 'Hello', width = 1239, height = 1752, url } = {}) {
  return {
    page: idx,
    url: url || `/api/files/task-passthrough?as=page&n=${idx}`,
    textUrl: `/api/files/task-passthrough?as=text&n=${idx}`,
    text,
    width,
    height,
  }
}

// Mock getTask to return our fixture
vi.mock('../src/store.mjs', () => ({
  getTask: vi.fn((taskId) => mockTask),
  upsertTask: vi.fn(),
  loadTasks: vi.fn(() => []),
}))

let mockTask = null

// ============ 单元测试：passthrough strategy 路由 ============

describe('renderTranslatedPage — strategy 路由', () => {
  beforeEach(async () => {
    mockTask = null
    vi.resetModules()
    // 清空 translate-render 的内存缓存（不同 test 之间需要隔离）
    const trMod = await import('../src/translate-render.mjs')
    if (typeof trMod.__resetTranslateRenderCache === 'function') {
      trMod.__resetTranslateRenderCache()
    }
    // 清空磁盘缓存（page-XXX.html/png），确保每个 test 都有 fresh first call
    // 缓存布局：translate-render-cache/{taskId}/{targetLang}/page-{nnn}.{html,png}
    const rootCache = path.join(CONFIG.DATA_DIR, 'translate-render-cache')
    const tryTaskDirs = ['task-passthrough', 'task-synthetic']
    for (const tid of tryTaskDirs) {
      const taskDir = path.join(rootCache, tid)
      try {
        const langDirs = fs.readdirSync(taskDir)
        for (const lang of langDirs) {
          const langDir = path.join(taskDir, lang)
          try {
            const stat = fs.statSync(langDir)
            if (!stat.isDirectory()) continue
            const files = fs.readdirSync(langDir)
            for (const f of files) {
              if (/^page-\d+\.(html|png)$/.test(f)) {
                try { fs.unlinkSync(path.join(langDir, f)) } catch {}
              }
            }
          } catch {}
        }
      } catch {}
    }
  })

  it('1. strategy="passthrough" + DOCX 任务 → imagePath = 源 page.png（无 soffice 二次转换）', async () => {
    // 动态 import 让 mock 生效
    const { renderTranslatedPage } = await import('../src/translate-render.mjs')
    const { getTask } = await import('../src/store.mjs')

    const srcPage = makePage({ idx: 1, text: '你好世界' })
    mockTask = makeTask({ ext: 'docx', pages: [srcPage] })
    getTask.mockReturnValue(mockTask)

    // 监听 convertWithSoffice 不被调用
    const converterMod = await import('../src/converter.mjs')
    const sofficeSpy = vi.spyOn(converterMod, 'convertWithSoffice')

    const result = await renderTranslatedPage({
      taskId: 'task-passthrough',
      pageNum: 1,
      sourceText: '你好世界',
      targetLang: 'en',
      targetText: '你好世界',
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
        { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 },
      ],
      strategy: 'passthrough',
    })

    // 不调 soffice
    expect(sofficeSpy).not.toHaveBeenCalled()
    // 返回源 page 信息
    expect(result.imagePath).toContain('page-001.png')
    expect(result.textPath).toContain('page-001.html')
    expect(result.pageW).toBe(1239)
    expect(result.pageH).toBe(1752)
  })

  it('2. strategy="passthrough" + DOCX 任务 → textPath 含 v6 文字层（data-pdfium="6"）', async () => {
    const { renderTranslatedPage } = await import('../src/translate-render.mjs')
    const { getTask } = await import('../src/store.mjs')

    mockTask = makeTask({ ext: 'docx', pages: [makePage({ idx: 1, text: 'A' })] })
    getTask.mockReturnValue(mockTask)

    const result = await renderTranslatedPage({
      taskId: 'task-passthrough',
      pageNum: 1,
      sourceText: 'A',
      targetLang: 'en',
      targetText: 'A',
      charMap: [{ srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 }],
      strategy: 'passthrough',
    })

    // 文字层存在且是 v6
    const fs = await import('node:fs')
    expect(fs.existsSync(result.textPath)).toBe(true)
    const content = fs.readFileSync(result.textPath, 'utf-8')
    expect(content).toContain('data-pdfium="6"')
  })

  it('3. strategy="passthrough" + PDF 任务 → imagePath = 源 page.png', async () => {
    const { renderTranslatedPage } = await import('../src/translate-render.mjs')
    const { getTask } = await import('../src/store.mjs')

    mockTask = makeTask({ ext: 'pdf', pages: [makePage({ idx: 2, text: 'Page 2' })] })
    getTask.mockReturnValue(mockTask)

    const result = await renderTranslatedPage({
      taskId: 'task-passthrough',
      pageNum: 2,
      sourceText: 'Page 2',
      targetLang: 'zh-CN',
      targetText: 'Page 2',
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
        { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 3 },
        { srcStart: 4, srcEnd: 5, tgtStart: 4, tgtEnd: 4 },
        { srcStart: 5, srcEnd: 6, tgtStart: 5, tgtEnd: 5 },
      ],
      strategy: 'passthrough',
    })

    expect(result.imagePath).toContain('page-002.png')
    expect(result.textPath).toContain('page-002.html')
  })

  it('4. strategy="synthetic"（默认）→ 走 v3.1 旧管线（buildTranslatedHtml + soffice）', async () => {
    const { renderTranslatedPage } = await import('../src/translate-render.mjs')
    const converterMod = await import('../src/converter.mjs')
    const rasterizeMod = await import('../src/pdf-rasterize.mjs')
    const sofficeSpy = vi.spyOn(converterMod, 'convertWithSoffice')
    // mock soffice 返回真实可用的占位 PDF（用空路径，让 rasterizeThumb mock 接管）
    sofficeSpy.mockResolvedValue('/tmp/mock-synthetic.pdf')
    // mock rasterizeThumb / imageDimensions 避免真 PDFium 解析
    vi.spyOn(rasterizeMod, 'rasterizeThumb').mockResolvedValue('/tmp/mock-synthetic.png')
    vi.spyOn(rasterizeMod, 'imageDimensions').mockResolvedValue({ width: 794, height: 1123 })
    // mock pdfiumExtractTextRuns
    const pdfiumMod = await import('../src/pdfium-render.mjs')
    vi.spyOn(pdfiumMod, 'pdfiumExtractTextRuns').mockResolvedValue({
      runs: [], pageWidthPx: 794, pageHeightPx: 1123,
    })

    const result = await renderTranslatedPage({
      taskId: 'task-synthetic',
      pageNum: 1,
      sourceText: 'Hello',
      targetLang: 'en',
      targetText: 'Hello',
      charMap: [{ srcStart: 0, srcEnd: 5, tgtStart: 0, tgtEnd: 5 }],
      strategy: 'synthetic',  // 显式 synthetic
    })

    // 走 soffice 管线
    expect(sofficeSpy).toHaveBeenCalled()
    expect(result.imagePath).toBeDefined()
  })

  it('5. strategy="passthrough" + pageNum 越界 → 抛 PageNotFound', async () => {
    const { renderTranslatedPage } = await import('../src/translate-render.mjs')
    const { getTask } = await import('../src/store.mjs')

    mockTask = makeTask({ ext: 'docx', pages: [makePage({ idx: 1, text: 'A' })] })  // 只有 1 页
    getTask.mockReturnValue(mockTask)

    await expect(renderTranslatedPage({
      taskId: 'task-passthrough',
      pageNum: 99,  // 越界
      sourceText: 'A',
      targetLang: 'en',
      targetText: 'A',
      charMap: [],
      strategy: 'passthrough',
    })).rejects.toThrow(/page 99 not found/i)
  })

  it('6. strategy="passthrough" + 缓存命中 → 直返（不重做 PDFium 提 run）', async () => {
    const { renderTranslatedPage } = await import('../src/translate-render.mjs')
    const { getTask } = await import('../src/store.mjs')

    mockTask = makeTask({ ext: 'docx', pages: [makePage({ idx: 1, text: 'Cached' })] })
    getTask.mockReturnValue(mockTask)

    // 第一次：写入缓存
    const r1 = await renderTranslatedPage({
      taskId: 'task-passthrough',
      pageNum: 1,
      sourceText: 'Cached',
      targetLang: 'en',
      targetText: 'Cached',
      charMap: [
        { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
        { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
        { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 2 },
        { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 3 },
        { srcStart: 4, srcEnd: 5, tgtStart: 4, tgtEnd: 4 },
        { srcStart: 5, srcEnd: 6, tgtStart: 5, tgtEnd: 5 },
      ],
      strategy: 'passthrough',
    })
    expect(r1.cached).toBe(false)

    // 第二次：应该命中缓存
    const r2 = await renderTranslatedPage({
      taskId: 'task-passthrough',
      pageNum: 1,
      sourceText: 'Cached',
      targetLang: 'en',
      targetText: 'Cached',
      charMap: r1.imagePath ? [] : [],  // charMap 不影响缓存命中
      strategy: 'passthrough',
    })
    expect(r2.cached).toBe(true)
  })
})
