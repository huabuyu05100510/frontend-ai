// pdf-rasterize.mjs 文字层/栅格化测试（PDFium 统一管线版本）
// 模型：Claude MiniMax-M3（MiniMax）
// 本测试覆盖 server/src/pdf-rasterize.mjs 的公开 API（已重写为 PDFium 路由）：
//   getPdfPageCount / rasterizeAllPages / rasterizeThumb / imageDimensions
//   extractTextLayer / extractAllTextLayers / fileSize
// 关键不变式（PDFium 同引擎）：
//   - 文字层 HTML 每字符一个 span，无 flex 行容器
//   - 根 div 带 class="pdf-text-layer" data-pdfium="4" data-page-w/h
//   - rasterizeAllPages 输出 PNG 真实像素与 rasterizeDPI 数学一致
//   - 不存在 PDF 不抛错（graceful fallback 返回 0 / 空 HTML）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { build3PagePdf } from './fixtures/build-fixture.mjs'

const TMP_ROOT = path.join(os.tmpdir(), 'pdf-textlayer-test-' + Date.now())
let FIXTURE_PDF

beforeAll(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true })
  FIXTURE_PDF = path.join(TMP_ROOT, 'fixture-3p.pdf')
  fs.writeFileSync(FIXTURE_PDF, build3PagePdf())
  if (!fs.existsSync(FIXTURE_PDF)) throw new Error('fixture generation failed')
})

afterAll(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }) } catch {}
})

describe('extractTextLayer — PDFium 路由', () => {
  it('从 fixture PDF 提取单页文字层到 HTML 文件', async () => {
    const { extractTextLayer } = await import('../src/pdf-rasterize.mjs')
    const outPath = path.join(TMP_ROOT, 'page-1.html')
    const result = await extractTextLayer(FIXTURE_PDF, 1, outPath, { renderDpi: 96 })
    expect(result.page).toBe(1)
    expect(result.file).toBe(outPath)
    expect(result.chars).toBeGreaterThan(0)
    expect(result.runs).toBeGreaterThan(0)
    expect(fs.existsSync(outPath)).toBe(true)
    const html = fs.readFileSync(outPath, 'utf-8')
    expect(html).toContain('class="pdf-text-layer"')
    expect(html).toContain('data-pdfium="4"')
    expect(html).toMatch(/<span style="position:absolute/)
    expect(html).not.toMatch(/<p /) // 无 flex 行容器
  })

  it('不存在的 PDF 文件优雅降级（不抛错，返回 0 chars + 空 layer）', async () => {
    const { extractTextLayer } = await import('../src/pdf-rasterize.mjs')
    const outPath = path.join(TMP_ROOT, 'should-not-exist.html')
    const result = await extractTextLayer('/nonexistent/foo.pdf', 1, outPath)
    expect(result.chars).toBe(0)
    expect(fs.existsSync(outPath)).toBe(true)
    const html = fs.readFileSync(outPath, 'utf-8')
    expect(html).toContain('class="pdf-text-layer"')
  })

  it('页码越界时返回空 bbox（不抛错）', async () => {
    const { extractTextLayer } = await import('../src/pdf-rasterize.mjs')
    const outPath = path.join(TMP_ROOT, 'page-99.html')
    const result = await extractTextLayer(FIXTURE_PDF, 99, outPath, { renderDpi: 96 })
    expect(result.page).toBe(99)
    expect(result.chars).toBe(0)
    expect(fs.existsSync(outPath)).toBe(true)
  })

  it('【核心】文字层 HTML 含 data-page-w/h（前端权威尺寸兜底）', async () => {
    const { extractTextLayer } = await import('../src/pdf-rasterize.mjs')
    const outPath = path.join(TMP_ROOT, 'page-1-dims.html')
    await extractTextLayer(FIXTURE_PDF, 1, outPath, { renderDpi: 96 })
    const html = fs.readFileSync(outPath, 'utf-8')
    // 96 DPI Letter: 612*96/72=816, 792*96/72=1056
    expect(html).toContain('data-page-w="816.00"')
    expect(html).toContain('data-page-h="1056.00"')
  })
})

describe('rasterizeAllPages - 每页真实像素尺寸', () => {
  it('返回 {page,file,width,height}，width/height 与 PNG 实际像素一致', async () => {
    const { rasterizeAllPages, imageDimensions } = await import('../src/pdf-rasterize.mjs')
    const outDir = path.join(TMP_ROOT, 'raster-dims')
    const results = await rasterizeAllPages(FIXTURE_PDF, outDir, 'page', 120, 1)
    expect(results.length).toBe(3)
    for (const r of results) {
      expect(r).toHaveProperty('width')
      expect(r).toHaveProperty('height')
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
      const dims = await imageDimensions(r.file)
      expect(r.width).toBe(dims.width)
      expect(r.height).toBe(dims.height)
    }
    // Letter @ 120 DPI 精确值
    expect(results[0].width).toBe(1020)
    expect(results[0].height).toBe(1320)
  })

  it('DPI 不一致时 width/height 随之缩放（96 DPI → 816x1056）', async () => {
    const { rasterizeAllPages } = await import('../src/pdf-rasterize.mjs')
    const outDir = path.join(TMP_ROOT, 'raster-dims-96')
    const results = await rasterizeAllPages(FIXTURE_PDF, outDir, 'page', 96, 1)
    expect(results[0].width).toBe(816)
    expect(results[0].height).toBe(1056)
  })

  it('PDFium 引擎标记（filename 后缀 + 文件大小 > 0）', async () => {
    const { rasterizeAllPages } = await import('../src/pdf-rasterize.mjs')
    const outDir = path.join(TMP_ROOT, 'raster-marker')
    const results = await rasterizeAllPages(FIXTURE_PDF, outDir, 'page', 96, 1)
    for (const r of results) {
      const stat = fs.statSync(r.file)
      expect(stat.size).toBeGreaterThan(100) // 合法 PNG 至少几百字节
      // 文件首 8 字节是 PNG 签名
      const fd = fs.openSync(r.file, 'r')
      const head = Buffer.alloc(8)
      fs.readSync(fd, head, 0, 8, 0)
      fs.closeSync(fd)
      expect(head[0]).toBe(0x89); expect(head[1]).toBe(0x50); expect(head[2]).toBe(0x4E); expect(head[3]).toBe(0x47)
    }
  })
})

describe('extractAllTextLayers', () => {
  it('并行模式产物完整（每页都有 HTML）', async () => {
    const { extractAllTextLayers } = await import('../src/pdf-rasterize.mjs')
    const dir = path.join(TMP_ROOT, 'text-parallel')
    const result = await extractAllTextLayers(FIXTURE_PDF, dir, 'page', 2, 96)
    expect(result.length).toBe(3)
    expect(fs.existsSync(path.join(dir, 'page-001.html'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'page-002.html'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'page-003.html'))).toBe(true)
    for (const r of result) {
      expect(r.chars).toBeGreaterThan(0)
    }
  })

  it('parallel=1 与 parallel=2 产物等价', async () => {
    const { extractAllTextLayers } = await import('../src/pdf-rasterize.mjs')
    const dirA = path.join(TMP_ROOT, 'text-a')
    const a = await extractAllTextLayers(FIXTURE_PDF, dirA, 'page', 1, 96)
    const dirB = path.join(TMP_ROOT, 'text-b')
    const b = await extractAllTextLayers(FIXTURE_PDF, dirB, 'page', 2, 96)
    expect(a.length).toBe(b.length)
    const charsA = a.map(r => r.chars).sort()
    const charsB = b.map(r => r.chars).sort()
    expect(charsA).toEqual(charsB)
  })

  it('progress 回调被按页调用', async () => {
    const { extractAllTextLayers } = await import('../src/pdf-rasterize.mjs')
    const dir = path.join(TMP_ROOT, 'text-progress')
    const calls = []
    await extractAllTextLayers(FIXTURE_PDF, dir, 'page', 1, 96, (done) => calls.push(done))
    expect(calls.at(-1)).toBe(3)
    expect(calls.length).toBe(3)
  })

  it('按页号排序返回', async () => {
    const { extractAllTextLayers } = await import('../src/pdf-rasterize.mjs')
    const dir = path.join(TMP_ROOT, 'text-sorted')
    const r = await extractAllTextLayers(FIXTURE_PDF, dir, 'page', 2, 96)
    for (let i = 1; i < r.length; i++) {
      expect(r[i].page).toBeGreaterThan(r[i - 1].page)
    }
  })
})

describe('可观测 + 边界', () => {
  it('pdfRenderEngine 返回当前引擎标识（pdfium-wasm 或 fallback-poppler）', async () => {
    const { pdfRenderEngine } = await import('../src/pdf-rasterize.mjs')
    const engine = pdfRenderEngine()
    expect(['pdfium-wasm@2.1.13', 'fallback-poppler']).toContain(engine)
  })

  it('getPdfPageCount 与 PDFium 直连一致', async () => {
    const { getPdfPageCount } = await import('../src/pdf-rasterize.mjs')
    const { pdfiumGetPageCount } = await import('../src/pdfium-render.mjs')
    const a = await getPdfPageCount(FIXTURE_PDF)
    const b = await pdfiumGetPageCount(FIXTURE_PDF)
    expect(a).toBe(b)
    expect(a).toBe(3)
  })
})

describe('真实中文 PDF 端到端（跳过无样本）', () => {
  const samplePath = path.resolve(__dirname, '..', '..', '..', '..', 'files', '郭亚平_前端_2604.pdf')
  it('extractTextLayer 正确处理中文 PDF（char-level，无 alpha/beta hack）', async function () {
    if (!fs.existsSync(samplePath)) {
      console.log(`[skip] sample not found: ${samplePath}`)
      return
    }
    const { extractTextLayer } = await import('../src/pdf-rasterize.mjs')
    const outPath = path.join(TMP_ROOT, 'cn-page-1.html')
    const result = await extractTextLayer(samplePath, 1, outPath, { renderDpi: 120 })
    expect(result.chars).toBeGreaterThan(10)
    const html = fs.readFileSync(outPath, 'utf-8')
    expect(/[一-鿿]/.test(html)).toBe(true)
    expect(html).toContain('data-pdfium="4"')
    expect(html).not.toMatch(/<p /) // 无 flex 行容器
  }, 30_000)
})
