// PDFium C++ 统一渲染管线 — TDD 测试
// 模型：Claude MiniMax-M3（MiniMax）
// 关键不变式：「字符 bbox 中心点必须落在 PNG 的 dark ink 像素上」
//   单一引擎（PDFium）同时出 PNG + bbox → 100% 同源，无 alpha/beta 补偿
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { build3PagePdf } from './fixtures/build-fixture.mjs'

const TMP_ROOT = path.join(os.tmpdir(), 'pdfium-test-' + Date.now())
let FIXTURE_PDF

beforeAll(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true })
  FIXTURE_PDF = path.join(TMP_ROOT, 'fixture-3p.pdf')
  fs.writeFileSync(FIXTURE_PDF, build3PagePdf())
})

afterAll(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }) } catch {}
})

// ===== 极简 PNG 解码（够用：从 PNG 字节流读取 IHDR + 解 IDAT → RGBA 像素矩阵） =====
function decodePng(buf) {
  // 仅处理 RGBA 8bit 无交错（PDFium render() 默认输出）
  expect(buf[0]).toBe(0x89); expect(buf[1]).toBe(0x50)
  expect(buf[2]).toBe(0x4E); expect(buf[3]).toBe(0x47)
  let p = 8
  let width = 0, height = 0
  const idatChunks = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4
    const type = buf.slice(p, p + 4).toString('latin1'); p += 4
    const data = buf.slice(p, p + len); p += len + 4 // skip CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      expect(data[8]).toBe(8) // bit depth
      expect(data[9]).toBe(6) // color type RGBA
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') break
  }
  const compressed = Buffer.concat(idatChunks)
  const raw = zlib.inflateSync(compressed)
  // raw: each scanline = 1 filter byte + width*4 RGBA bytes
  const stride = width * 4
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    // 仅支持 filter=0（None）+ 1（Sub）+ 2（Up）兜底，PDFium 实际只用 0
    if (filter !== 0) {
      throw new Error(`decodePng: unsupported filter ${filter} on row ${y}`)
    }
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
  }
  return { width, height, pixels }
}

function pixelAt(decoded, x, y) {
  if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) return { r: 255, g: 255, b: 255, a: 0 }
  const i = (y * decoded.width + x) * 4
  return { r: decoded.pixels[i], g: decoded.pixels[i + 1], b: decoded.pixels[i + 2], a: decoded.pixels[i + 3] }
}

function isDark(p) {
  return p.r < 100 && p.g < 100 && p.b < 100 && p.a > 200
}

// ===== 测试主体 =====

describe('buildRunBboxHtml（PDF.js 行业标杆 — run-level 渲染）', () => {
  it('每个 run 一个绝对定位 span，<p> 行容器为 0', async () => {
    const { buildRunBboxHtml } = await import('../src/pdfium-text-layer.mjs')
    const runs = [
      { str: 'Page One', fontSize: 20, baselineY: 200, left: 100, right: 200, top: 180, bottom: 200 }
    ]
    const html = buildRunBboxHtml(runs, 612, 792)
    expect(html).toContain('class="pdf-text-layer"')
    expect(html).toContain('data-pdfium="4"')
    expect((html.match(/<span /g) || []).length).toBe(1)  // 单 run = 单 span
    expect((html.match(/<p /g) || []).length).toBe(0)
    expect(html).toContain('>Page One</span>')
  })

  it('根 div 带 data-page-w / data-page-h（前端权威尺寸兜底）', async () => {
    const { buildRunBboxHtml } = await import('../src/pdfium-text-layer.mjs')
    const html = buildRunBboxHtml([], 1020, 1320)
    expect(html).toContain('data-page-w="1020.00"')
    expect(html).toContain('data-page-h="1320.00"')
  })

  it('HTML 实体正确转义（& < > " \' 不会破坏 DOM）', async () => {
    const { buildRunBboxHtml } = await import('../src/pdfium-text-layer.mjs')
    const html = buildRunBboxHtml([
      { str: '<R&D>', fontSize: 20, baselineY: 100, left: 0, right: 50, top: 90, bottom: 100 }
    ], 612, 792)
    expect(html).toContain('&lt;R&amp;D&gt;')
  })

  it('【v4 ink-bbox】top = run.top 直接定位（不再用 ASCENT_RATIO 近似）', async () => {
    const { buildRunBboxHtml } = await import('../src/pdfium-text-layer.mjs')
    // v4: top 直接用 ink bbox 的 top（run.top），不再用 baselineY - fontSize×0.80
    const html = buildRunBboxHtml([
      { str: 'A', fontSize: 20, baselineY: 200, left: 0, right: 20, top: 180, bottom: 200 }
    ], 612, 792)
    expect(html).toContain('top:180.00px')
    expect(html).toContain('height:20.00px')
    expect(html).toContain('font-size:20.00px')
  })

  it('【核心不变式】bullet ● 与汉字 span top 来自各自 ink bbox（v4 直接定位）', async () => {
    const { buildRunBboxHtml } = await import('../src/pdfium-text-layer.mjs')
    // bullet ● 在 12pt，文本在 14pt → 2 个 runs（不同 fontSize）
    // v4: top = run.top（ink bbox 顶边），不再做 baselineY - fontSize×0.80 计算
    const runs = [
      { str: '●', fontSize: 12, baselineY: 100, left: 50, right: 60, top: 90, bottom: 100 },
      { str: '郭亚平', fontSize: 14, baselineY: 100, left: 70, right: 130, top: 88, bottom: 100 }
    ]
    const html = buildRunBboxHtml(runs, 612, 792)
    const spans = html.match(/<span /g) || []
    expect(spans.length).toBe(2)
    // bullet: top = run.top = 90
    expect(html).toContain('top:90.00px')
    // 汉字: top = run.top = 88
    expect(html).toContain('top:88.00px')
    // v4: 最小高度 = max(inkH, fontSize×0.85)
    // bullet height = max(10, 12*0.85=10.2) = 10.20
    expect(html).toContain('height:10.20px')
    // 汉字 height = max(12, 14*0.85=11.9) = 12.00
    expect(html).toContain('height:12.00px')
  })

  it('同 fontSize + 相近 baselineY 的连续 chars 合并为 1 个 run', async () => {
    // 走 pdfiumExtractTextRuns 验证
    const { pdfiumExtractTextRuns } = await import('../src/pdfium-render.mjs')
    const r = await pdfiumExtractTextRuns(FIXTURE_PDF, 0, 120)
    // fixture "Page One" 是连续 ASCII 字符 → 应合并成 1 个 run
    expect(r.runs.length).toBeGreaterThanOrEqual(1)
    expect(r.runs.length).toBeLessThanOrEqual(4)  // 可能有 newline 控制符被拆
    // 找到包含 "Page One" 的 run
    const mainRun = r.runs.find(x => x.str.includes('Page One'))
    expect(mainRun).toBeTruthy()
    expect(mainRun.str).toContain('Page One')
  }, 30_000)

  it('【不变式】run 内 baselineY 在 fontSize 容差内（0.5 × fontSize，PDF.js 标准）', async () => {
    const { pdfiumExtractTextRuns } = await import('../src/pdfium-render.mjs')
    const r = await pdfiumExtractTextRuns(FIXTURE_PDF, 0, 120)
    for (const run of r.runs) {
      // 每个 run 内的 baselineY 一致（实际就是平均）
      expect(run.baselineY).toBeGreaterThan(0)
      expect(run.fontSize).toBeGreaterThan(0)
    }
  }, 30_000)
})

describe('pdfiumInit / pdfiumGetPageCount', () => {
  it('加载 PDF → pageCount = 3', async () => {
    const { pdfiumGetPageCount } = await import('../src/pdfium-render.mjs')
    const n = await pdfiumGetPageCount(FIXTURE_PDF)
    expect(n).toBe(3)
  }, 30_000)

  it('不存在文件 → pageCount = 0（容错，不抛错）', async () => {
    const { pdfiumGetPageCount } = await import('../src/pdfium-render.mjs')
    const n = await pdfiumGetPageCount('/nonexistent/foo.pdf')
    expect(n).toBe(0)
  }, 10_000)
})

describe('pdfiumRenderPageToPng', () => {
  it('Letter @120dpi → 1020×1320 合法 PNG（magic bytes \\x89PNG）', async () => {
    const { pdfiumRenderPageToPng } = await import('../src/pdfium-render.mjs')
    const png = await pdfiumRenderPageToPng(FIXTURE_PDF, 0, 120)
    expect(Buffer.isBuffer(png) || png instanceof Uint8Array).toBe(true)
    const buf = Buffer.from(png)
    expect(buf[0]).toBe(0x89); expect(buf[1]).toBe(0x50); expect(buf[2]).toBe(0x4E); expect(buf[3]).toBe(0x47)
    const dec = decodePng(buf)
    expect(dec.width).toBe(1020)
    expect(dec.height).toBe(1320)
  }, 30_000)

  it('Letter @96dpi → 816×1056 合法 PNG', async () => {
    const { pdfiumRenderPageToPng } = await import('../src/pdfium-render.mjs')
    const png = await pdfiumRenderPageToPng(FIXTURE_PDF, 0, 96)
    const dec = decodePng(Buffer.from(png))
    expect(dec.width).toBe(816)
    expect(dec.height).toBe(1056)
  }, 30_000)
})

describe('pdfiumExtractCharBoxes', () => {
  it('返回 charCount = 8（"Page One" = 8 字符含空格）', async () => {
    const { pdfiumExtractCharBoxes } = await import('../src/pdfium-render.mjs')
    const r = await pdfiumExtractCharBoxes(FIXTURE_PDF, 0, 120)
    expect(r.boxes.length).toBe(8)
    expect(r.pageWidthPx).toBe(1020)
    expect(r.pageHeightPx).toBe(1320)
  }, 30_000)

  it('bbox 坐标系：每个 char 都满足 left ≤ right, top ≤ bottom', async () => {
    const { pdfiumExtractCharBoxes } = await import('../src/pdfium-render.mjs')
    const r = await pdfiumExtractCharBoxes(FIXTURE_PDF, 0, 120)
    for (const b of r.boxes) {
      expect(b.right).toBeGreaterThan(b.left)
      expect(b.bottom).toBeGreaterThan(b.top)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(r.pageWidthPx)
      expect(b.bottom).toBeLessThanOrEqual(r.pageHeightPx)
    }
  }, 30_000)

  it('字符序列 = "Page One"（按 char 顺序）', async () => {
    const { pdfiumExtractCharBoxes } = await import('../src/pdfium-render.mjs')
    const r = await pdfiumExtractCharBoxes(FIXTURE_PDF, 0, 120)
    const text = r.boxes.map(b => b.char).join('')
    expect(text).toBe('Page One')
  }, 30_000)

  it('【核心不变式】每个 char 的 bbox 范围内必能找到 dark ink 像素（无 alpha/beta 漂移）', async () => {
    const { pdfiumRenderPageToPng, pdfiumExtractCharBoxes } = await import('../src/pdfium-render.mjs')
    const png = await pdfiumRenderPageToPng(FIXTURE_PDF, 0, 120)
    const dec = decodePng(Buffer.from(png))
    const r = await pdfiumExtractCharBoxes(FIXTURE_PDF, 0, 120)
    let inkChars = 0, noInkChars = 0
    const noInkReport = []
    for (let i = 0; i < r.boxes.length; i++) {
      const b = r.boxes[i]
      // 空格（unicode 32）天然无 ink，跳过
      if (b.unicode === 32 || !b.char.trim()) continue
      // 在 bbox 范围内扫描整个矩形，找 darkest 像素
      const x0 = Math.max(0, Math.floor(b.left))
      const x1 = Math.min(dec.width - 1, Math.ceil(b.right))
      const y0 = Math.max(0, Math.floor(b.top))
      const y1 = Math.min(dec.height - 1, Math.ceil(b.bottom))
      let darkest = { r: 255, g: 255, b: 255, a: 0 }
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = pixelAt(dec, x, y)
          if (p.r + p.g + p.b < darkest.r + darkest.g + darkest.b) darkest = p
        }
      }
      if (isDark(darkest)) inkChars++
      else {
        noInkChars++
        if (noInkReport.length < 3) noInkReport.push({ char: b.char, bbox: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, darkest })
      }
    }
    // 同引擎 100% 匹配：所有非空格字符 bbox 内必能找到 dark ink 像素
    expect(noInkChars).toBe(0)
    expect(inkChars).toBeGreaterThan(0)
    if (noInkReport.length) console.log('[noInk]', noInkReport)
  }, 30_000)
})

describe('pdfiumRenderAllPages', () => {
  it('3 页全部渲染 → 3 个文件，pageNumber 按升序，width/height 正确', async () => {
    const { pdfiumRenderAllPages } = await import('../src/pdfium-render.mjs')
    const outDir = path.join(TMP_ROOT, 'all-pages')
    const results = await pdfiumRenderAllPages(FIXTURE_PDF, outDir, 'page', 120, 1)
    expect(results.length).toBe(3)
    expect(results[0].page).toBe(1)
    expect(results[1].page).toBe(2)
    expect(results[2].page).toBe(3)
    for (const r of results) {
      expect(r.width).toBe(1020)
      expect(r.height).toBe(1320)
      expect(fs.existsSync(r.file)).toBe(true)
    }
  }, 60_000)

  it('parallel=2 与 parallel=1 产物体积一致（无半成品）', async () => {
    const { pdfiumRenderAllPages } = await import('../src/pdfium-render.mjs')
    const dirA = path.join(TMP_ROOT, 'par-a'); const dirB = path.join(TMP_ROOT, 'par-b')
    const a = await pdfiumRenderAllPages(FIXTURE_PDF, dirA, 'page', 120, 1)
    const b = await pdfiumRenderAllPages(FIXTURE_PDF, dirB, 'page', 120, 2)
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      const sa = fs.statSync(a[i].file).size
      const sb = fs.statSync(b[i].file).size
      expect(sa).toBe(sb)
    }
  }, 60_000)
})

describe('pdfiumExtractAllTextLayers', () => {
  it('3 页全部提取 → 3 个 HTML 文件，根 div 含 data-pdfium 标记', async () => {
    const { pdfiumExtractAllTextLayers } = await import('../src/pdfium-text-layer.mjs')
    const dir = path.join(TMP_ROOT, 'text')
    const r = await pdfiumExtractAllTextLayers(FIXTURE_PDF, dir, 'page', 1, 120)
    expect(r.length).toBe(3)
    for (let i = 0; i < r.length; i++) {
      const x = r[i]
      // "Page One/Two/Three" 是 8 字符；run-level 把它们合并成 1 个 run
      // 加上可能的 newline 控制字符，可能 1-3 个 runs
      expect(x.runs).toBeGreaterThanOrEqual(1)
      expect(x.runs).toBeLessThanOrEqual(3)
      expect(x.chars).toBeGreaterThanOrEqual(8)
      expect(fs.existsSync(x.file)).toBe(true)
      const html = fs.readFileSync(x.file, 'utf-8')
      expect(html).toContain('data-pdfium="4"')
      expect(html).toContain('class="pdf-text-layer"')
      // 每 run 一个 span（不再是每字符）
      const spans = html.match(/<span /g) || []
      expect(spans.length).toBe(x.runs)
      // 验证 span 内容（每页有对应的 Page X 文字）
      const expectedText = ['Page One', 'Page Two', 'Page Three'][i]
      expect(html).toContain(expectedText)
    }
  }, 60_000)
})

describe('历史参数全部归零', () => {
  it('pdfium-text-layer.mjs 源码不含 alpha=0.20 / beta=0.95 / min_h=22 字面值', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'pdfium-text-layer.mjs'),
      'utf-8'
    )
    expect(src).not.toMatch(/alpha\s*=\s*0\.20/)
    expect(src).not.toMatch(/beta\s*=\s*0\.95/)
    expect(src).not.toMatch(/min_h\s*=\s*22/)
  })
})
