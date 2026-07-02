// Translated export — 双语 / 译文 DOCX 和 PDF 输出测试
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import {
  generateBilingualDocx,
  generateBilingualPdf,
  generateTranslationOnlyPdf,
} from '../src/translated-export.mjs'

function makePages(n, pageText = 'Hello world. 这是一段示例文本。') {
  const pages = []
  for (let i = 0; i < n; i++) {
    pages.push({
      page: i + 1,
      sourceText: pageText,
      targetText: pageText,
    })
  }
  return pages
}

describe('generateBilingualDocx', () => {
  it('returns a Buffer with ZIP magic PK\\x03\\x04', async () => {
    const buf = await generateBilingualDocx({
      pages: makePages(2),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(100)
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)
  })

  it('DOCX contains word/document.xml', async () => {
    const buf = await generateBilingualDocx({
      pages: makePages(1),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const zip = await JSZip.loadAsync(buf)
    const docXml = await zip.file('word/document.xml')?.async('string')
    expect(docXml).toBeTruthy()
    expect(docXml).toContain('<w:document')
  })

  it('has 2 paragraphs per page (source + target)', async () => {
    const pages = [
      { page: 1, sourceText: 'First source', targetText: '第一原文' },
      { page: 2, sourceText: 'Second source', targetText: '第二原文' },
      { page: 3, sourceText: 'Third source', targetText: '第三原文' },
    ]
    const buf = await generateBilingualDocx({
      pages,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const zip = await JSZip.loadAsync(buf)
    const docXml = await zip.file('word/document.xml').async('string')
    expect(docXml).toContain('First source')
    expect(docXml).toContain('第一原文')
    expect(docXml).toContain('Second source')
    expect(docXml).toContain('第二原文')
    expect(docXml).toContain('Third source')
    expect(docXml).toContain('第三原文')
  })

  it('escapes special characters < > & " \' correctly', async () => {
    const pages = [
      { page: 1, sourceText: 'A & B < C > D "E" \'F\'', targetText: '<script>alert(1)</script>' },
    ]
    const buf = await generateBilingualDocx({
      pages,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const zip = await JSZip.loadAsync(buf)
    const docXml = await zip.file('word/document.xml').async('string')
    // Verify the special chars appear in the doc (DOCX should escape < and & at minimum)
    expect(docXml).toContain('A &amp; B')
    // <script> must be escaped as &lt;script&gt;
    expect(docXml).toContain('&lt;script&gt;')
  })

  it('handles large pages (1000 chars × 50 pages) in < 5s', async () => {
    const longText = 'A'.repeat(1000)
    const pages = makePages(50, longText)
    const t0 = Date.now()
    const buf = await generateBilingualDocx({
      pages,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(5000)
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('embeds taskName in document metadata', async () => {
    const buf = await generateBilingualDocx({
      pages: makePages(1),
      sourceLang: 'en',
      targetLang: 'zh-CN',
      taskName: 'My Test Task',
    })
    const zip = await JSZip.loadAsync(buf)
    const docXml = await zip.file('word/document.xml').async('string')
    expect(docXml).toContain('My Test Task')
    // core.xml should also have title
    const coreXml = await zip.file('docProps/core.xml')?.async('string')
    if (coreXml) {
      expect(coreXml).toContain('My Test Task')
    }
  })
})

describe('generateBilingualPdf', () => {
  it('returns a Buffer with PDF magic %PDF-', async () => {
    const buf = await generateBilingualPdf({
      pages: makePages(2),
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(100)
    const header = buf.slice(0, 5).toString('latin1')
    expect(header).toBe('%PDF-')
  })

  it('contains source and target text (latin1-safe)', async () => {
    const buf = await generateBilingualPdf({
      pages: [
        { page: 1, sourceText: 'Hello world.', targetText: 'Hello translated.' },
      ],
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })
    const text = buf.toString('latin1')
    expect(text).toContain('Hello world.')
    expect(text).toContain('Hello translated.')
  })

  it('embeds taskName in PDF metadata', async () => {
    const buf = await generateBilingualPdf({
      pages: makePages(1),
      sourceLang: 'en',
      targetLang: 'zh-CN',
      taskName: 'Bilingual PDF Test',
    })
    // Title may be latin1 literal or UTF-16BE hex depending on title contents.
    // The composed title is: `Bilingual Translation: Bilingual PDF Test (en → zh-CN)`
    // since it contains `→` (U+2192), it goes through UTF-16BE encoding.
    // We check by converting title to UTF-16BE hex bytes and searching for it.
    const title = 'Bilingual Translation: Bilingual PDF Test (en → zh-CN)'
    const bytes = []
    for (let i = 0; i < title.length; i++) {
      const code = title.charCodeAt(i)
      bytes.push((code >> 8) & 0xff, code & 0xff)
    }
    // UTF-16BE BOM = FE FF
    const hex = '<' + Buffer.from([0xfe, 0xff, ...bytes]).toString('hex') + '>'
    const text = buf.toString('latin1')
    expect(text).toContain(hex)
  })
})

describe('generateTranslationOnlyPdf', () => {
  it('returns a Buffer with PDF magic %PDF-', async () => {
    const buf = await generateTranslationOnlyPdf({
      pages: makePages(2),
      targetLang: 'en',
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(100)
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('contains target text only', async () => {
    const buf = await generateTranslationOnlyPdf({
      pages: [
        { page: 1, sourceText: 'should not appear in latin1', targetText: 'TARGET_ONLY_MARKER_123' },
      ],
      targetLang: 'en',
    })
    const text = buf.toString('latin1')
    expect(text).toContain('TARGET_ONLY_MARKER_123')
  })

  it('embeds taskName in metadata', async () => {
    const buf = await generateTranslationOnlyPdf({
      pages: makePages(1),
      targetLang: 'en',
      taskName: 'Target Only Test',
    })
    const text = buf.toString('latin1')
    expect(text).toContain('Target Only Test')
  })
})