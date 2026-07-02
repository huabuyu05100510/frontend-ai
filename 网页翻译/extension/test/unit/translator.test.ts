import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildPrompt, parseSseDelta, splitTranslations, translateConcurrent } from '../../src/background/translator'

describe('buildPrompt — Prompt 构建', () => {
  it('包含目标语言', () => {
    const prompt = buildPrompt([{ id: '1', text: 'Hello world' }], '中文', null)
    expect(prompt).toContain('中文')
    expect(prompt).toContain('Hello world')
  })

  it('单段：不用 SEP 分隔符', () => {
    const prompt = buildPrompt([{ id: '1', text: 'Hello world test' }], '中文', null)
    expect(prompt).not.toContain('<SEP>')
  })

  it('多段：用 <SEP> 分隔', () => {
    const prompt = buildPrompt(
      [{ id: '1', text: 'First paragraph' }, { id: '2', text: 'Second paragraph' }],
      '中文',
      null,
    )
    expect(prompt).toContain('<SEP>')
  })

  it('携带术语表时注入 glossary', () => {
    const glossary = new Map([['Apple', '苹果公司'], ['CEO', '首席执行官']])
    const prompt = buildPrompt([{ id: '1', text: 'Apple CEO said...' }], '中文', glossary)
    expect(prompt).toContain('Apple→苹果公司')
    expect(prompt).toContain('CEO→首席执行官')
  })

  it('空术语表不注入术语行', () => {
    const prompt = buildPrompt([{ id: '1', text: 'Hello world' }], '中文', new Map())
    expect(prompt).not.toContain('术语表')
  })
})

describe('parseSseDelta — SSE 流解析', () => {
  it('解析标准 MiniMax delta', () => {
    const line = 'data: {"choices":[{"delta":{"content":"你好"}}]}'
    expect(parseSseDelta(line)).toBe('你好')
  })

  it('[DONE] 返回 null', () => {
    expect(parseSseDelta('data: [DONE]')).toBeNull()
  })

  it('空行返回 null', () => {
    expect(parseSseDelta('')).toBeNull()
    expect(parseSseDelta('   ')).toBeNull()
  })

  it('非 data: 行返回 null', () => {
    expect(parseSseDelta('event: done')).toBeNull()
    expect(parseSseDelta(': ping')).toBeNull()
  })

  it('content 为空字符串返回 null', () => {
    const line = 'data: {"choices":[{"delta":{"content":""}}]}'
    expect(parseSseDelta(line)).toBeNull()
  })

  it('JSON 解析失败安全返回 null', () => {
    expect(parseSseDelta('data: {broken json')).toBeNull()
  })
})

describe('splitTranslations — 多段拆分', () => {
  it('单段不拆分', () => {
    const result = splitTranslations('你好世界', 1)
    expect(result).toEqual(['你好世界'])
  })

  it('按 <SEP> 拆分多段', () => {
    const result = splitTranslations('第一段\n<SEP>\n第二段\n<SEP>\n第三段', 3)
    expect(result).toEqual(['第一段', '第二段', '第三段'])
  })

  it('LLM 少输出时用空字符串填充', () => {
    const result = splitTranslations('只有一段', 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('只有一段')
    expect(result[1]).toBe('')
    expect(result[2]).toBe('')
  })

  it('去除首尾空白', () => {
    const result = splitTranslations('  第一段  \n<SEP>\n  第二段  ', 2)
    expect(result[0]).toBe('第一段')
    expect(result[1]).toBe('第二段')
  })
})

// ─── translateConcurrent — 一段一请求 + 并发 + 重试 ───────
// 这些测试针对卡死 bug：原来把 8 段塞一个 prompt 让模型 <SEP> 拆分，
// 模型偶尔漏 <SEP> → 译文错位/为空 → 进度卡死。改成一段一请求彻底解决。

function mockSseResponse(text: string): Response {
  const lines = [
    `data: {"choices":[{"delta":{"content":"${text}"}}]}`,
    'data: [DONE]',
  ]
  const body = lines.join('\n') + '\n'
  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(body))
      ctrl.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('translateConcurrent — 一段一请求', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  it('每段单独发一个请求（不再批量塞 SEP）', async () => {
    const segments = [
      { id: 'a', text: 'hello' },
      { id: 'b', text: 'world' },
      { id: 'c', text: 'foo' },
    ]
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => mockSseResponse('译'))

    const results: Array<{ segmentId: string; translation: string }> = []
    for await (const r of translateConcurrent(segments, 'auto', 'zh', 'k', 2)) {
      results.push(r)
    }

    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(results).toHaveLength(3)
    expect(results.map(r => r.segmentId).sort()).toEqual(['a', 'b', 'c'])
    expect(results.every(r => r.translation === '译')).toBe(true)
  })

  it('并发上限：4', async () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, text: `t${i}` }))

    let inflight = 0
    let maxInflight = 0
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise(r => setTimeout(r, 10))
      inflight--
      return mockSseResponse('译')
    })

    for await (const _ of translateConcurrent(segments, 'auto', 'zh', 'k', 4)) {
      // consume
    }

    expect(maxInflight).toBeLessThanOrEqual(4)
    expect(global.fetch).toHaveBeenCalledTimes(10)
  })

  it('单段失败时重试 1 次后成功', async () => {
    let calls = 0
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('network')
      return mockSseResponse('好')
    })

    const results: Array<{ segmentId: string; translation: string }> = []
    for await (const r of translateConcurrent([{ id: 'x', text: 'hi' }], 'auto', 'zh', 'k', 1)) {
      results.push(r)
    }

    expect(calls).toBe(2) // 失败 1 次 + 重试 1 次
    expect(results).toEqual([{ segmentId: 'x', translation: '好' }])
  })

  it('重试仍失败时不抛错，yield 空译文（避免卡死整批）', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'))

    const results: Array<{ segmentId: string; translation: string }> = []
    for await (const r of translateConcurrent(
      [{ id: 'y', text: 'hi' }],
      'auto',
      'zh',
      'k',
      1,
      1,
    )) {
      results.push(r)
    }

    expect(results).toEqual([{ segmentId: 'y', translation: '' }])
  })

  it('结果顺序与输入一致（即使并发完成顺序不同）', { timeout: 30_000 }, async () => {
    const segments = [
      { id: 's0', text: 'a' },
      { id: 's1', text: 'b' },
      { id: 's2', text: 'c' },
    ]
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      // 第二段慢一点
      if (body.messages[1].content.includes('b')) {
        await new Promise(r => setTimeout(r, 30))
      }
      return mockSseResponse(body.messages[1].content.slice(-2))
    })

    const results: Array<{ segmentId: string; translation: string }> = []
    for await (const r of translateConcurrent(segments, 'auto', 'zh', 'k', 3)) {
      results.push(r)
    }

    expect(results.map(r => r.segmentId)).toEqual(['s0', 's1', 's2'])
  })
})
