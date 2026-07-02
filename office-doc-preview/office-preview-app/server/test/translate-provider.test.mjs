// translate-provider.mjs 单元测试
// 模型：claude-sonnet-4-6

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { translateAI, getActiveProvider, getAvailableProviders } from '../src/translate-provider.mjs'

describe('translate-provider', () => {

  describe('getAvailableProviders', () => {
    it('returns at least mock', () => {
      const providers = getAvailableProviders()
      expect(providers).toContain('mock')
    })

    it('returns an array', () => {
      expect(Array.isArray(getAvailableProviders())).toBe(true)
    })
  })

  describe('translateAI with mock (default)', () => {
    it('returns empty result for empty text', async () => {
      const r = await translateAI({ text: '', sourceLang: 'zh-CN', targetLang: 'en', provider: 'mock' })
      expect(r.target).toBe('')
      expect(r.charMap).toEqual([])
      expect(r.provider).toBe('none')
      expect(r.engine).toBe('empty')
      expect(r.ms).toBe(0)
    })

    it('translates with language tag prefix', async () => {
      const r = await translateAI({ text: '你好世界', sourceLang: 'zh-CN', targetLang: 'en', provider: 'mock' })
      expect(r.target).toContain('你好世界')
      expect(r.target).toContain('[en]')
      expect(r.provider).toBe('mock')
      expect(r.engine).toBe('mock-ai-v1')
      expect(r.ms).toBeGreaterThanOrEqual(0)
    })

    it('handles zh-CN → ja', async () => {
      const r = await translateAI({ text: 'こんにちは', sourceLang: 'zh-CN', targetLang: 'ja', provider: 'mock' })
      expect(r.target).toContain('[ja]')
      expect(r.provider).toBe('mock')
    })

    it('handles long text', async () => {
      const longText = '这是一个测试文本，包含多个句子。每个句子都应当被正确处理。\n第二行内容。'
      const r = await translateAI({ text: longText, sourceLang: 'zh-CN', targetLang: 'en', provider: 'mock' })
      expect(r.target).toContain('[en]')
      expect(r.target.length).toBeGreaterThan(longText.length)
    })

    it('returns ms as number', async () => {
      const r = await translateAI({ text: 'test', sourceLang: 'zh-CN', targetLang: 'en', provider: 'mock' })
      expect(typeof r.ms).toBe('number')
    })
  })

  describe('provider fallback when no API key', () => {
    it('falls back to mock when minimax key missing', async () => {
      // Ensure no MINIMAX_API_KEY set for this test
      const r = await translateAI({ text: '你好', sourceLang: 'zh-CN', targetLang: 'en', provider: 'minimax' })
      expect(r.provider).toMatch(/mock/)
    })

    it('falls back to mock when zhipu key missing', async () => {
      const r = await translateAI({ text: '你好', sourceLang: 'zh-CN', targetLang: 'en', provider: 'zhipu' })
      expect(r.provider).toMatch(/mock/)
    })

    it('falls back to mock when volcano key missing', async () => {
      const r = await translateAI({ text: '你好', sourceLang: 'zh-CN', targetLang: 'en', provider: 'volcano' })
      expect(r.provider).toMatch(/mock/)
    })
  })

  describe('translateAI with all supported langs', () => {
    const langs = ['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru']
    for (const src of langs) {
      for (const tgt of langs) {
        if (src === tgt) continue
        it(`translates ${src} → ${tgt} (mock)`, async () => {
          const r = await translateAI({ text: 'Hello World', sourceLang: src, targetLang: tgt, provider: 'mock' })
          expect(r.target).toBeTruthy()
          expect(r.provider).toBeDefined()
          expect(typeof r.ms).toBe('number')
        })
      }
    }
  })

  describe('charMap', () => {
    it('returns empty charMap for mock provider', async () => {
      const r = await translateAI({ text: '你好', sourceLang: 'zh-CN', targetLang: 'en', provider: 'mock' })
      expect(r.charMap).toEqual([])
    })
  })

  describe('concurrency limit does not break', () => {
    it('handles concurrent requests', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        translateAI({ text: `task ${i}`, sourceLang: 'zh-CN', targetLang: 'en', provider: 'mock' })
      )
      const results = await Promise.all(tasks)
      expect(results).toHaveLength(5)
      for (const r of results) {
        expect(r.target).toBeTruthy()
        expect(r.ms).toBeGreaterThanOrEqual(0)
      }
    })
  })
})