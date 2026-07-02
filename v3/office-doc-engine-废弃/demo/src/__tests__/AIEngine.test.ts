import { describe, it, expect, vi } from 'vitest'
import { AIEngine } from '../ai/AIEngine'

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of gen) chunks.push(chunk)
  return chunks
}

describe('AIEngine', () => {
  const engine = new AIEngine()

  // ── stream ─────────────────────────────────────────
  describe('stream()', () => {
    it('yields non-empty tokens for continue command', async () => {
      const tokens = await collect(
        engine.stream({ command: 'continue', selectedText: '', context: 'The weather today is' })
      )
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.join('')).not.toBe('')
    })

    it('yields tokens for summarize command', async () => {
      const tokens = await collect(
        engine.stream({ command: 'summarize', selectedText: 'A very long article about technology trends.' })
      )
      expect(tokens.join('')).toBeTruthy()
    })

    it('yields tokens for translate command (EN→ZH)', async () => {
      const tokens = await collect(
        engine.stream({ command: 'translate', selectedText: 'Hello world', targetLanguage: 'zh' })
      )
      expect(tokens.join('')).toBeTruthy()
    })

    it('yields tokens for fix_grammar command', async () => {
      const tokens = await collect(
        engine.stream({ command: 'fix_grammar', selectedText: 'He go to school yesterday.' })
      )
      expect(tokens.join('')).toBeTruthy()
    })

    it('aborts streaming when signal fires', async () => {
      const controller = new AbortController()
      const gen = engine.stream(
        { command: 'continue', selectedText: '', context: 'Long text to stream...' },
        controller.signal
      )

      const tokens: string[] = []
      const reading = (async () => {
        for await (const t of gen) {
          tokens.push(t)
          if (tokens.length === 2) controller.abort()
        }
      })()

      await reading
      expect(tokens.length).toBeLessThanOrEqual(5) // aborted early
    })

    it('each streamed chunk is a non-empty string', async () => {
      const tokens = await collect(
        engine.stream({ command: 'expand', selectedText: 'AI is useful.' })
      )
      for (const t of tokens) {
        expect(typeof t).toBe('string')
        expect(t.length).toBeGreaterThan(0)
      }
    })
  })

  // ── detectLanguage ─────────────────────────────────
  describe('detectLanguage()', () => {
    it('detects Chinese text', () => {
      expect(engine.detectLanguage('这是一段中文文本，用于测试语言检测')).toBe('zh')
    })

    it('detects English text', () => {
      expect(engine.detectLanguage('This is an English sentence for testing')).toBe('en')
    })

    it('detects mixed text (majority wins)', () => {
      const lang = engine.detectLanguage('Hello 你好 World 世界 Test 测试')
      expect(['zh', 'en']).toContain(lang)
    })

    it('returns unknown for empty text', () => {
      expect(engine.detectLanguage('')).toBe('unknown')
    })
  })

  // ── buildContext ────────────────────────────────────
  describe('buildContext()', () => {
    it('respects maxTokens limit', () => {
      const longText = 'word '.repeat(500)
      const ctx = engine.buildContext(longText, 100, 50)
      expect(ctx.estimatedTokens).toBeLessThanOrEqual(50)
    })

    it('includes surrounding text around cursor', () => {
      const text = 'prefix content here cursor is here suffix content here'
      const cursorPos = text.indexOf('cursor')
      const ctx = engine.buildContext(text, cursorPos, 200)
      expect(ctx.surroundingText).toContain('prefix')
    })

    it('handles cursor at start of document', () => {
      const ctx = engine.buildContext('hello world', 0, 200)
      expect(ctx.surroundingText).toBeDefined()
    })

    it('handles cursor at end of document', () => {
      const text = 'hello world'
      const ctx = engine.buildContext(text, text.length, 200)
      expect(ctx.surroundingText).toBeDefined()
    })
  })
})
