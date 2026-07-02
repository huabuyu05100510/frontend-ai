// 百度通用 OCR (accurate_basic) — 单元测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { getAccessToken, _resetTokenCacheForTests } from '../src/baidu-iocr.mjs'

describe('百度 access_token 缓存', () => {
  beforeEach(() => {
    _resetTokenCacheForTests()
    delete process.env.BAIDU_OCR_API_KEY
    delete process.env.BAIDU_OCR_SECRET_KEY
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无 AK/SK → isMock=true', async () => {
    const r = await getAccessToken()
    expect(r.isMock).toBe(true)
    expect(r.token).toBeNull()
  })

  it('有 AK/SK → 调 token endpoint，缓存返回', async () => {
    process.env.BAIDU_OCR_API_KEY = 'test-ak'
    process.env.BAIDU_OCR_SECRET_KEY = 'test-sk'
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok-xxx', expires_in: 2592000 }), { status: 200 })
    )
    const r = await getAccessToken()
    expect(r.isMock).toBe(false)
    expect(r.token).toBe('tok-xxx')
    expect(mockFetch).toHaveBeenCalledOnce()
    // URL 含 grant_type=client_credentials
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('grant_type=client_credentials')
    expect(url).toContain('client_id=test-ak')
    expect(url).toContain('client_secret=test-sk')
  })

  it('token 有效期内复用缓存，不重复请求', async () => {
    process.env.BAIDU_OCR_API_KEY = 'ak'
    process.env.BAIDU_OCR_SECRET_KEY = 'sk'
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 2592000 }), { status: 200 })
    )
    await getAccessToken()
    await getAccessToken()
    await getAccessToken()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
