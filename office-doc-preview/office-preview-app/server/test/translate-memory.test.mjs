// Translation Memory CRUD + bigram Jaccard 相似度测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'

import {
  scoreSimilarity,
  addTmEntry,
  lookupTm,
  deleteTmEntry,
  listTm,
  countTm,
  clearTm,
} from '../src/translate-memory.mjs'

let tmDir

beforeAll(() => {
  tmDir = path.join(CONFIG.DERIVED_DIR, 'translation-memory')
  fs.rmSync(tmDir, { recursive: true, force: true })
})

beforeEach(() => {
  if (fs.existsSync(tmDir)) {
    for (const f of fs.readdirSync(tmDir)) {
      fs.unlinkSync(path.join(tmDir, f))
    }
  }
})

describe('scoreSimilarity — bigram Jaccard', () => {
  it('returns 1.0 for identical strings', () => {
    expect(scoreSimilarity('hello', 'hello')).toBe(1)
    expect(scoreSimilarity('你好世界', '你好世界')).toBe(1)
  })

  it('returns ~0 for disjoint strings (hello vs world)', () => {
    const s = scoreSimilarity('hello', 'world')
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThan(0.3)
  })

  it('returns 0 for empty string vs non-empty', () => {
    expect(scoreSimilarity('', 'hello')).toBe(0)
    expect(scoreSimilarity('hello', '')).toBe(0)
    expect(scoreSimilarity('', '')).toBe(0)
  })

  it('handles short strings (<2 chars) gracefully', () => {
    expect(scoreSimilarity('a', 'a')).toBeGreaterThanOrEqual(0)
    expect(scoreSimilarity('a', 'b')).toBeGreaterThanOrEqual(0)
    expect(scoreSimilarity('ab', 'ab')).toBe(1)
  })

  it('gives high score for partial overlap', () => {
    const s = scoreSimilarity('hello world', 'hello there')
    expect(s).toBeGreaterThan(0.2)
    expect(s).toBeLessThan(1)
  })
})

describe('Translation Memory CRUD', () => {
  it('add → list → delete round trip', () => {
    const e1 = addTmEntry({
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '你好',
      target: 'hello',
    })
    expect(e1.id).toBeTruthy()
    expect(e1.source).toBe('你好')
    expect(e1.target).toBe('hello')

    const list = listTm({ sourceLang: 'zh-CN', targetLang: 'en' })
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(e1.id)

    const ok = deleteTmEntry({ id: e1.id, sourceLang: 'zh-CN', targetLang: 'en' })
    expect(ok).toBe(true)
    expect(listTm({ sourceLang: 'zh-CN', targetLang: 'en' }).length).toBe(0)
  })

  it('lookupTm filters by threshold', () => {
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '今天天气很好', target: 'the weather is nice today' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '完全无关的内容', target: 'completely unrelated' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '今天天气不错', target: 'today weather is good' })

    const high = lookupTm({ sourceLang: 'zh-CN', targetLang: 'en', query: '今天天气很好', threshold: 0.5 })
    expect(high.length).toBeGreaterThanOrEqual(1)
    const highIds = high.map(h => h.source)
    expect(highIds).toContain('今天天气很好')

    const veryHigh = lookupTm({ sourceLang: 'zh-CN', targetLang: 'en', query: '今天天气很好', threshold: 0.9 })
    expect(veryHigh.length).toBeGreaterThanOrEqual(1)
    // Should include the exact match first
    expect(veryHigh[0].source).toBe('今天天气很好')
  })

  it('lookupTm returns sorted by score DESC', () => {
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: 'foo bar baz', target: 'AAA' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: 'foo bar qux', target: 'BBB' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: 'completely different text here', target: 'CCC' })

    const results = lookupTm({ sourceLang: 'zh-CN', targetLang: 'en', query: 'foo bar baz', threshold: 0.0, limit: 10 })
    expect(results.length).toBe(3)
    // First should be exact match with score 1.0
    expect(results[0].source).toBe('foo bar baz')
    expect(results[0].score).toBe(1)
    // Scores should be in descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('countTm returns accurate count', () => {
    expect(countTm({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(0)
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '一', target: 'one' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '二', target: 'two' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '三', target: 'three' })
    expect(countTm({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(3)

    // Different language pair is separate
    addTmEntry({ sourceLang: 'en', targetLang: 'ja', source: 'hello', target: 'こんにちは' })
    expect(countTm({ sourceLang: 'en', targetLang: 'ja' })).toBe(1)
    expect(countTm({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(3)
  })

  it('clearTm wipes entries for a language pair', () => {
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '你好', target: 'hello' })
    addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: '世界', target: 'world' })
    addTmEntry({ sourceLang: 'en', targetLang: 'ja', source: 'hello', target: 'こんにちは' })

    expect(clearTm({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(true)
    expect(countTm({ sourceLang: 'zh-CN', targetLang: 'en' })).toBe(0)
    // Other pair unaffected
    expect(countTm({ sourceLang: 'en', targetLang: 'ja' })).toBe(1)
  })

  it('lookupTm respects limit', () => {
    for (let i = 0; i < 10; i++) {
      addTmEntry({ sourceLang: 'zh-CN', targetLang: 'en', source: `测试 ${i}`, target: `test ${i}` })
    }
    const limited = lookupTm({ sourceLang: 'zh-CN', targetLang: 'en', query: '测试', threshold: 0.0, limit: 3 })
    expect(limited.length).toBe(3)
  })

  it('addTmEntry returns entry with all fields including optional context', () => {
    const e = addTmEntry({
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '机器翻译',
      target: 'machine translation',
      context: 'AI/ML domain',
    })
    expect(e.context).toBe('AI/ML domain')
    expect(e.sourceLang).toBe('zh-CN')
    expect(e.targetLang).toBe('en')
    expect(typeof e.ts).toBe('number')
  })
})