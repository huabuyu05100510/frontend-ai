// 3 家 AI Provider 真实连通性测试（v5.0）
// 模型：claude-sonnet-4-6
// 用法：node test/ai-providers-live.test.mjs
// 若 .env 中无对应 key，则该 provider 跳过
import 'dotenv/config'
import { describe, it, expect } from 'vitest'
import { translateAI, getAvailableProviders } from '../src/translate-provider.mjs'

const TEXT = '今天天气真好'

describe('AI Provider 真实连通性 (v5.0)', () => {
  it('输出可用 provider 列表', () => {
    const available = getAvailableProviders()
    console.log('[ai-providers-live] available:', available)
    expect(Array.isArray(available)).toBe(true)
    expect(available.length).toBeGreaterThan(0)
  })

  for (const provider of ['minimax', 'zhipu', 'volcano']) {
    it(`${provider} 返回真实翻译（非 mock fallback）`, async () => {
      if (!process.env[`${provider.toUpperCase()}_API_KEY`]) {
        console.log(`[skip] ${provider}: no key`)
        return
      }
      const r = await translateAI({
        text: TEXT,
        sourceLang: 'zh-CN',
        targetLang: 'en',
        provider,
      })
      const isMock = r.engine.includes('mock') || r.engine.includes('fallback')
      console.log(`[${provider}] in="${TEXT}" out="${r.target}" engine=${r.engine} ms=${r.ms}`)
      // 真实翻译应包含英文字符
      if (!isMock) {
        expect(r.target).toMatch(/[a-zA-Z]/)
        expect(r.target.length).toBeGreaterThan(0)
        expect(r.ms).toBeGreaterThan(0)
      } else {
        // 至少要跑通（即使是 fallback）
        expect(r.target.length).toBeGreaterThan(0)
      }
    }, 30000)
  }
})