// translate-glossary CSV-importable term dictionary — persistence + matching tests
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'

let glossariesDir

beforeAll(() => {
  glossariesDir = path.join(CONFIG.DERIVED_DIR, 'glossaries')
  fs.rmSync(glossariesDir, { recursive: true, force: true })
})

afterAll(() => {
  fs.rmSync(glossariesDir, { recursive: true, force: true })
})

beforeEach(() => {
  if (fs.existsSync(glossariesDir)) {
    for (const f of fs.readdirSync(glossariesDir)) {
      try { fs.unlinkSync(path.join(glossariesDir, f)) } catch { /* ignore */ }
    }
  }
})

async function load() {
  return await import('../src/translate-glossary.mjs')
}

describe('translate-glossary: parseCsv', () => {
  it('parses UTF-8 BOM CSV (中文 Excel 导出) with header', async () => {
    const m = await load()
    const buf = Buffer.from('\uFEFFsource,target,pos,note\n合同,contract,n,法律\n发票,invoice,n,', 'utf-8')
    const rows = m.parseCsv(buf)
    expect(rows.length).toBe(2)
    expect(rows[0].source).toBe('合同')
    expect(rows[0].target).toBe('contract')
    expect(rows[0].pos).toBe('n')
    expect(rows[0].note).toBe('法律')
    expect(rows[1].source).toBe('发票')
    expect(rows[1].target).toBe('invoice')
  })

  it('parses quoted fields with embedded commas', async () => {
    const m = await load()
    const csv = 'source,target,note\n"Hello, world","Bonjour, monde","greeting, casual"\n'
    const rows = m.parseCsv(csv)
    expect(rows.length).toBe(1)
    expect(rows[0].source).toBe('Hello, world')
    expect(rows[0].target).toBe('Bonjour, monde')
    expect(rows[0].note).toBe('greeting, casual')
  })

  it('parses multi-line cells inside quoted fields', async () => {
    const m = await load()
    const csv = 'source,target,note\n"line1\nline2","dest","multi\nline note"\n'
    const rows = m.parseCsv(csv)
    expect(rows.length).toBe(1)
    expect(rows[0].source).toBe('line1\nline2')
    expect(rows[0].note).toBe('multi\nline note')
  })

  it('tolerates missing pos and note columns; returns array even with only source+target header', async () => {
    const m = await load()
    const csv = 'source,target\nfoo,bar\nbaz,qux\n'
    const rows = m.parseCsv(csv)
    expect(rows.length).toBe(2)
    expect(rows[0].source).toBe('foo')
    expect(rows[0].pos).toBeUndefined()
    expect(rows[0].note).toBeUndefined()
  })
})

describe('translate-glossary: appendTerm + listTerms + deleteTerm round-trip', () => {
  it('appends, lists, deletes a term in a single language pair', async () => {
    const m = await load()
    const t = m.appendTerm({
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '协议',
      target: 'agreement',
      pos: 'n',
      note: '法律',
    })
    expect(t.id).toBeTruthy()
    expect(t.source).toBe('协议')

    const list = m.listTerms({ sourceLang: 'zh-CN', targetLang: 'en' })
    expect(list.length).toBe(1)
    expect(list[0].source).toBe('协议')

    const ok = m.deleteTerm({ id: t.id, sourceLang: 'zh-CN', targetLang: 'en' })
    expect(ok).toBe(true)
    expect(m.listTerms({ sourceLang: 'zh-CN', targetLang: 'en' }).length).toBe(0)
  })
})

describe('translate-glossary: 200 term cap', () => {
  it('caps each language pair at 200 entries (newest kept)', async () => {
    const m = await load()
    for (let i = 0; i < 210; i++) {
      m.appendTerm({
        sourceLang: 'zh-CN',
        targetLang: 'en',
        source: `t${i}`,
        target: `e${i}`,
      })
    }
    const list = m.listTerms({ sourceLang: 'zh-CN', targetLang: 'en' })
    expect(list.length).toBeLessThanOrEqual(200)
    // Newest 10 must still be present (t200..t209), oldest must be gone
    const sources = new Set(list.map(t => t.source))
    expect(sources.has('t209')).toBe(true)
    expect(sources.has('t0')).toBe(false)
  })
})

describe('translate-glossary: matchTerm', () => {
  it('matches longest term first when multiple candidates overlap', async () => {
    const m = await load()
    const terms = [
      { source: 'cat', target: 'chat' },
      { source: 'catalog', target: 'catalogue' },
      { source: 'cat food', target: 'nourriture pour chat' },
    ]
    const matches = m.matchTerm('the catalog has cat food', terms)
    // catalog (7) > cat food (8) > cat (3) — actually food wins on length
    // All non-overlapping: catalog at idx 4, cat food at idx 15
    expect(matches.length).toBeGreaterThan(0)
    const catalogMatch = matches.find(x => x.term.source === 'catalog')
    expect(catalogMatch).toBeTruthy()
    expect(catalogMatch.translation).toBe('catalogue')
    const foodMatch = matches.find(x => x.term.source === 'cat food')
    expect(foodMatch).toBeTruthy()
    expect(foodMatch.translation).toBe('nourriture pour chat')
  })

  it('is case-insensitive (matches "Apple" from term "apple")', async () => {
    const m = await load()
    const terms = [{ source: 'apple', target: 'pomme' }]
    const matches = m.matchTerm('I like Apple pies.', terms)
    expect(matches.length).toBe(1)
    expect(matches[0].term.source).toBe('apple')
    expect(matches[0].start).toBe(7)
    expect(matches[0].end).toBe(12)
  })

  it('resolves overlapping candidates by picking the longest match', async () => {
    const m = await load()
    const terms = [
      { source: 'cat', target: 'chat' },
      { source: 'cats', target: 'chats' },
      { source: 'catsup', target: 'ketchup' },
    ]
    // "cats and catsup" — two non-overlapping regions of interest:
    //   pos 0: "cats" (4) wins over "cat" (3)
    //   pos 9: "catsup" (6) wins over "cats" (4) and "cat" (3)
    const matches = m.matchTerm('cats and catsup', terms)
    const byStart = matches.reduce((acc, x) => {
      acc[x.start] = x
      return acc
    }, {})
    expect(byStart[0].term.source).toBe('cats')
    expect(byStart[0].translation).toBe('chats')
    expect(byStart[9].term.source).toBe('catsup')
    expect(byStart[9].translation).toBe('ketchup')
    // No overlap redundancy
    expect(matches.length).toBe(2)
  })
})

describe('translate-glossary: applyGlossary', () => {
  it('replaces matched spans in place and preserves surrounding text', async () => {
    const m = await load()
    const terms = [
      { source: '合同', target: 'contract' },
      { source: '发票', target: 'invoice' },
    ]
    const out = m.applyGlossary('请查收合同与发票', terms)
    expect(out).toBe('请查收contract与invoice')
  })

  it('returns the original text when no terms match', async () => {
    const m = await load()
    const out = m.applyGlossary('没有任何匹配的文本', [{ source: '合同', target: 'contract' }])
    expect(out).toBe('没有任何匹配的文本')
  })

  it('handles multiple occurrences of the same term', async () => {
    const m = await load()
    const terms = [{ source: '你好', target: 'hello' }]
    const out = m.applyGlossary('你好世界，你好', terms)
    expect(out).toBe('hello世界，hello')
  })
})

describe('translate-glossary: countTerms', () => {
  it('returns the number of terms for a given language pair', async () => {
    const m = await load()
    expect(m.countTerms({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(0)
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: 'a', target: 'A' })
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: 'b', target: 'B' })
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: 'c', target: 'C' })
    expect(m.countTerms({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(3)
  })
})

describe('translate-glossary: clearGlossary', () => {
  it('removes all terms for a language pair and returns true', async () => {
    const m = await load()
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: 'x', target: 'X' })
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: 'y', target: 'Y' })
    const ok = m.clearGlossary({ sourceLang: 'zh-CN', targetLang: 'en' })
    expect(ok).toBe(true)
    expect(m.listTerms({ sourceLang: 'zh-CN', targetLang: 'en' }).length).toBe(0)
    // clearing again returns true (idempotent)
    expect(m.clearGlossary({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(true)
  })
})

describe('translate-glossary: multi-pair isolation', () => {
  it('zh-CN→en and zh-CN→ja do not affect each other', async () => {
    const m = await load()
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: '公司', target: 'company' })
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: '员工', target: 'employee' })
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'ja', source: '公司', target: '会社' })
    m.appendTerm({ sourceLang: 'zh-CN', targetLang: 'ja', source: '员工', target: '社員' })

    const enTerms = m.listTerms({ sourceLang: 'zh-CN', targetLang: 'en' })
    const jaTerms = m.listTerms({ sourceLang: 'zh-CN', targetLang: 'ja' })
    expect(enTerms.length).toBe(2)
    expect(jaTerms.length).toBe(2)
    expect(enTerms.map(t => t.target).sort()).toEqual(['company', 'employee'])
    expect(jaTerms.map(t => t.target).sort()).toEqual(['会社', '社員']) // cspell:ignore 社員

    // Delete in en doesn't touch ja
    const enIds = enTerms.map(t => t.id)
    m.deleteTerm({ id: enIds[0], sourceLang: 'zh-CN', targetLang: 'en' })
    expect(m.listTerms({ sourceLang: 'zh-CN', targetLang: 'en' }).length).toBe(1)
    expect(m.listTerms({ sourceLang: 'zh-CN', targetLang: 'ja' }).length).toBe(2)

    // files live in separate JSONL files
    const files = fs.readdirSync(glossariesDir)
    expect(files.some(f => f.includes('zh-CN') && f.includes('en'))).toBe(true)
    expect(files.some(f => f.includes('zh-CN') && f.includes('ja'))).toBe(true)
  })
})
