import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  toDeepLLang,
  endpointForKey,
  translateConcurrentDeepL,
} from '../../src/background/deepl'

describe('toDeepLLang — 内部语言码 → DeepL 大写码', () => {
  it('小写 → 大写', () => {
    expect(toDeepLLang('zh')).toBe('ZH')
    expect(toDeepLLang('en')).toBe('EN')
    expect(toDeepLLang('ja')).toBe('JA')
    expect(toDeepLLang('ko')).toBe('KO')
    expect(toDeepLLang('de')).toBe('DE')
    expect(toDeepLLang('fr')).toBe('FR')
  })

  it('已是大写时不变', () => {
    expect(toDeepLLang('ZH')).toBe('ZH')
  })

  it('空字符串仍合法（让 DeepL 自己拒）', () => {
    expect(toDeepLLang('')).toBe('')
  })

  it('混合大小写 normalize', () => {
    expect(toDeepLLang('Zh')).toBe('ZH')
    expect(toDeepLLang('eN')).toBe('EN')
  })
})

describe('endpointForKey — Free vs Pro 自动路由', () => {
  it(':fx 后缀 → Free endpoint', () => {
    expect(endpointForKey('dcc9fae3-6d36-4759-b671-5d8165db3334:fx')).toBe(
      'https://api-free.deepl.com/v2/translate',
    )
  })

  it('无 :fx 后缀 → Pro endpoint', () => {
    expect(endpointForKey('abc-123-pro-key-no-suffix')).toBe(
      'https://api.deepl.com/v2/translate',
    )
  })

  it('Pro key 含冒号但不是 :fx 仍走 Pro', () => {
    expect(endpointForKey('abc:def')).toBe('https://api.deepl.com/v2/translate')
  })

  it(':fx 必须是后缀，不能是中间', () => {
    expect(endpointForKey('fx:abc')).toBe('https://api.deepl.com/v2/translate')
  })
})

// helper：构造 DeepL mock response
function makeOkResponse(texts: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      translations: texts.map(t => ({ text: t, detected_source_language: 'EN' })),
    }),
    text: async () => '',
  }
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  }
}

describe('translateConcurrentDeepL — 翻译流程', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => makeOkResponse(['你好'])))
  })

  it('≤50 段走单批', async () => {
    const segments = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, text: `hello ${i}` }))
    const fetchCalls: string[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: any) => {
        const body = JSON.parse(init.body)
        fetchCalls.push(body.text)
        return makeOkResponse(body.text.map((t: string) => `[ZH] ${t}`))
      }),
    )
    const results = []
    for await (const r of translateConcurrentDeepL(segments, 'en', 'zh', 'test:fx')) {
      results.push(r)
    }
    expect(results).toHaveLength(3)
    expect(results[0].translation).toBe('[ZH] hello 0')
    expect(results[2].translation).toBe('[ZH] hello 2')
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toHaveLength(3)
  })

  it('>50 段自动分批（51 段 → 2 批）', async () => {
    const segments = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, text: `t${i}` }))
    const results = []
    for await (const r of translateConcurrentDeepL(segments, 'en', 'zh', 'test:fx')) {
      results.push(r)
    }
    expect(results).toHaveLength(51)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('空输入不调 fetch', async () => {
    const results = []
    for await (const r of translateConcurrentDeepL([], 'en', 'zh', 'test:fx')) {
      results.push(r)
    }
    expect(results).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('空 key 抛错', async () => {
    await expect(async () => {
      for await (const _ of translateConcurrentDeepL([{ id: 's1', text: 'hi' }], 'en', 'zh', '')) {
        // noop
      }
    }).rejects.toThrow(/empty/i)
  })

  it('单批失败 → 重试后成功', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        if (calls < 2) return makeErrorResponse(429, 'rate limited')
        return makeOkResponse(['成功'])
      }),
    )
    const results = []
    for await (const r of translateConcurrentDeepL(
      [{ id: 's1', text: 'hi' }],
      'en',
      'zh',
      'test:fx',
      4,
      3,
    )) {
      results.push(r)
    }
    expect(results[0].translation).toBe('成功')
    expect(calls).toBe(2)
  })

  it('整批重试耗尽 → 该批每段置空', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeErrorResponse(500, 'server error')))
    const segments = [
      { id: 'a', text: 'foo' },
      { id: 'b', text: 'bar' },
    ]
    const results = []
    for await (const r of translateConcurrentDeepL(segments, 'en', 'zh', 'test:fx', 4, 1)) {
      results.push(r)
    }
    expect(results).toHaveLength(2)
    expect(results[0].translation).toBe('')
    expect(results[1].translation).toBe('')
  })

  it('请求体包含 split_sentences=1 + target_lang 大写', async () => {
    let capturedBody: any = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: any) => {
        capturedBody = JSON.parse(init.body)
        return makeOkResponse(['你好'])
      }),
    )
    for await (const _ of translateConcurrentDeepL([{ id: 's1', text: 'hi' }], 'en', 'zh', 'test:fx')) {
      // noop
    }
    expect(capturedBody.split_sentences).toBe('1')
    expect(capturedBody.target_lang).toBe('ZH')
  })

  it('Authorization header 含 key', async () => {
    let capturedHeaders: any = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: any) => {
        capturedHeaders = init.headers
        return makeOkResponse(['你好'])
      }),
    )
    for await (const _ of translateConcurrentDeepL(
      [{ id: 's1', text: 'hi' }],
      'en',
      'zh',
      'my-secret-key:fx',
    )) {
      // noop
    }
    expect(capturedHeaders.Authorization).toBe('DeepL-Auth-Key my-secret-key:fx')
    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })
})
