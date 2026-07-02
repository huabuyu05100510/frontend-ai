// converter.mjs 单元测试
// 覆盖：signOnlyOfficeRequest、parseOnlyOfficeResponse 两个纯函数
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'

describe('signOnlyOfficeRequest', () => {
  let savedEnv
  beforeEach(() => {
    savedEnv = { ...process.env }
    vi.resetModules()
  })
  afterEach(() => {
    for (const k of Object.keys(savedEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  it('生成的 token 能用相同密钥验签', async () => {
    process.env.ONLYOFFICE_JWT_SECRET = 'secret-abc-1234567890'
    const { signOnlyOfficeRequest } = await import('../src/converter.mjs')
    const payload = { url: 'https://example.com/x.docx', filetype: 'docx' }
    const token = signOnlyOfficeRequest(payload)
    const decoded = jwt.verify(token, 'secret-abc-1234567890', { algorithms: ['HS256'] })
    expect(decoded).toMatchObject(payload)
  })

  it('HS256 算法显式声明', async () => {
    process.env.ONLYOFFICE_JWT_SECRET = 'secret-abc-1234567890'
    const { signOnlyOfficeRequest } = await import('../src/converter.mjs')
    const token = signOnlyOfficeRequest({ a: 1 })
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
    expect(header.alg).toBe('HS256')
  })

  it('错误密钥无法验签（数据完整性保护）', async () => {
    process.env.ONLYOFFICE_JWT_SECRET = 'secret-aaa'
    const { signOnlyOfficeRequest } = await import('../src/converter.mjs')
    const token = signOnlyOfficeRequest({ url: 'x' })
    expect(() => jwt.verify(token, 'wrong-secret', { algorithms: ['HS256'] })).toThrow()
  })
})

describe('parseOnlyOfficeResponse', () => {
  let parse
  beforeEach(async () => {
    vi.resetModules()
    process.env.ONLYOFFICE_JWT_SECRET = 'secret-abc-1234567890'
    const mod = await import('../src/converter.mjs')
    parse = mod.parseOnlyOfficeResponse
  })

  it('XML 成功响应 → 返回 fileUrl', () => {
    const xml = '<?xml version="1.0"?><FileResult><FileUrl>https://onlyoffice/cache/files/conv_abc/output.pdf/output.pdf?md5=xxx</FileUrl></FileResult>'
    expect(parse(xml)).toBe('https://onlyoffice/cache/files/conv_abc/output.pdf/output.pdf?md5=xxx')
  })

  it('XML 响应中 &amp; 实体应被解码为 &', () => {
    const xml = '<?xml version="1.0"?><FileResult><FileUrl>http://x/cache/output.pdf?md5=abc&amp;expires=123&amp;filename=out.pdf</FileUrl></FileResult>'
    expect(parse(xml)).toBe('http://x/cache/output.pdf?md5=abc&expires=123&filename=out.pdf')
  })

  it('XML 错误响应（错误码 -8 = JWT 失败）→ 抛 OnlyOfficeError', () => {
    const xml = '<?xml version="1.0"?><FileResult><Error>-8</Error></FileResult>'
    expect(() => parse(xml)).toThrow(/OnlyOfficeError.*-8|JWT|error code/i)
  })

  it('XML 既无 FileUrl 也无 Error → 抛错', () => {
    const xml = '<?xml version="1.0"?><FileResult></FileResult>'
    expect(() => parse(xml)).toThrow(/fileUrl|FileUrl/)
  })

  it('JSON 成功响应（老版本 OnlyOffice）→ 返回 fileUrl', () => {
    const json = JSON.stringify({ fileUrl: 'https://x/y.pdf' })
    expect(parse(json)).toBe('https://x/y.pdf')
  })

  it('JSON 错误响应 → 抛错', () => {
    const json = JSON.stringify({ error: 'Conversion failed' })
    expect(() => parse(json)).toThrow(/Conversion failed/)
  })

  it('完全乱码响应 → 抛错并附内容预览', () => {
    expect(() => parse('not xml not json {')).toThrow(/parse|响应/)
  })
})