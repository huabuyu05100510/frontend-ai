import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentModel } from '../core/DocumentModel'
import { ExportEngine } from '../export/ExportEngine'
import type { Block } from '../core/types'

function makeBlock(partial: Partial<Block> & { id: string; type: Block['type'] }): Block {
  return {
    content: '',
    children: [],
    props: {},
    meta: { createdBy: 'test', createdAt: 0, updatedAt: 0, version: 1 },
    ...partial,
  }
}

describe('ExportEngine', () => {
  let doc: DocumentModel
  const exporter = new ExportEngine()

  beforeEach(() => {
    doc = DocumentModel.empty('doc1', 'Test Document')
  })

  // ── Markdown ───────────────────────────────────────
  describe('toMarkdown()', () => {
    it('exports heading level 1 as # syntax', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'h', type: 'heading', content: 'My Title', props: { level: 1 } }))
      expect(exporter.toMarkdown(doc)).toContain('# My Title')
    })

    it('exports heading level 2 as ## syntax', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'h2', type: 'heading', content: 'Sub Title', props: { level: 2 } }))
      expect(exporter.toMarkdown(doc)).toContain('## Sub Title')
    })

    it('exports paragraph as plain text line', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'p', type: 'paragraph', content: 'Some text here' }))
      expect(exporter.toMarkdown(doc)).toContain('Some text here')
    })

    it('exports blockquote with > prefix', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'q', type: 'blockquote', content: 'Famous quote' }))
      expect(exporter.toMarkdown(doc)).toContain('> Famous quote')
    })

    it('exports code_block with triple backtick fence', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'code', type: 'code_block', content: 'const x = 1', props: { language: 'javascript' } }))
      const md = exporter.toMarkdown(doc)
      expect(md).toContain('```javascript')
      expect(md).toContain('const x = 1')
      expect(md).toContain('```')
    })

    it('exports code_block without language', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'code2', type: 'code_block', content: 'raw code', props: {} }))
      expect(exporter.toMarkdown(doc)).toContain('```\nraw code\n```')
    })

    it('exports bullet list with - prefix', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'ul', type: 'bullet_list', content: '' }))
      doc.insertBlock('ul', 0, makeBlock({ id: 'li1', type: 'list_item', content: 'Item one' }))
      doc.insertBlock('ul', 1, makeBlock({ id: 'li2', type: 'list_item', content: 'Item two' }))
      const md = exporter.toMarkdown(doc)
      expect(md).toContain('- Item one')
      expect(md).toContain('- Item two')
    })

    it('exports ordered list with number prefix', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'ol', type: 'ordered_list', content: '' }))
      doc.insertBlock('ol', 0, makeBlock({ id: 'oli1', type: 'list_item', content: 'First' }))
      doc.insertBlock('ol', 1, makeBlock({ id: 'oli2', type: 'list_item', content: 'Second' }))
      const md = exporter.toMarkdown(doc)
      expect(md).toContain('1. First')
      expect(md).toContain('2. Second')
    })

    it('exports divider as ---', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'hr', type: 'divider', content: '' }))
      expect(exporter.toMarkdown(doc)).toContain('---')
    })

    it('preserves document order', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'o1', type: 'heading', content: 'Title', props: { level: 1 } }))
      doc.insertBlock(doc.rootId, 1, makeBlock({ id: 'o2', type: 'paragraph', content: 'Intro' }))
      doc.insertBlock(doc.rootId, 2, makeBlock({ id: 'o3', type: 'paragraph', content: 'Body' }))
      const md = exporter.toMarkdown(doc)
      expect(md.indexOf('# Title')).toBeLessThan(md.indexOf('Intro'))
      expect(md.indexOf('Intro')).toBeLessThan(md.indexOf('Body'))
    })
  })

  // ── HTML ───────────────────────────────────────────
  describe('toHTML()', () => {
    it('outputs valid HTML with DOCTYPE', () => {
      const html = exporter.toHTML(doc)
      expect(html).toContain('<!DOCTYPE html>')
    })

    it('wraps headings in h1-h6 tags', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'hh', type: 'heading', content: 'Header', props: { level: 3 } }))
      expect(exporter.toHTML(doc)).toContain('<h3>Header</h3>')
    })

    it('wraps paragraph in <p> tag', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'pp', type: 'paragraph', content: 'Text' }))
      expect(exporter.toHTML(doc)).toContain('<p>Text</p>')
    })

    it('wraps code_block in <pre><code>', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'cb', type: 'code_block', content: 'let x' }))
      expect(exporter.toHTML(doc)).toContain('<pre><code>')
      expect(exporter.toHTML(doc)).toContain('let x')
    })

    it('escapes HTML entities in content', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'esc', type: 'paragraph', content: '<script>alert("xss")</script>' }))
      const html = exporter.toHTML(doc)
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })

  // ── Plain text ─────────────────────────────────────
  describe('toPlainText()', () => {
    it('strips all block formatting', () => {
      doc.insertBlock(doc.rootId, 0, makeBlock({ id: 'pt1', type: 'heading', content: 'Title', props: { level: 1 } }))
      doc.insertBlock(doc.rootId, 1, makeBlock({ id: 'pt2', type: 'paragraph', content: 'Content' }))
      const text = exporter.toPlainText(doc)
      expect(text).not.toContain('#')
      expect(text).toContain('Title')
      expect(text).toContain('Content')
    })
  })
})
