// config.mjs 配置项测试
// 验证：默认值、环境变量覆盖、必填项在生产模式下拒绝启动
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('CONFIG', () => {
  // 每次测试前清空相关环境变量，避免污染
  const ENV_KEYS = [
    'PORT', 'ONLYOFFICE_HOST', 'ONLYOFFICE_JWT_SECRET', 'HOST_FOR_DOCKER',
    'RASTERIZE_THUMB_DPI', 'RASTERIZE_PAGE_DPI', 'RASTERIZE_PAGE_PARALLEL',
    'RASTERIZE_TIMEOUT_MS', 'RASTERIZE_MAX_PAGES', 'NODE_ENV'
  ]
  let savedEnv = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  it('提供合理的默认值', async () => {
    const { CONFIG } = await import('../src/config.mjs')
    expect(CONFIG.PORT).toBe(5180)
    expect(CONFIG.ONLYOFFICE_HOST).toBe('http://localhost:8080')
    expect(CONFIG.ONLYOFFICE_JWT_SECRET).toMatch(/.{16,}/)
    expect(CONFIG.HOST_FOR_DOCKER).toMatch(/^https?:\/\/\S+/)
    expect(CONFIG.RASTERIZE_THUMB_DPI).toBeGreaterThan(0)
    expect(CONFIG.RASTERIZE_PAGE_DPI).toBeGreaterThan(0)
    expect(CONFIG.RASTERIZE_PAGE_PARALLEL).toBeGreaterThanOrEqual(1)
    expect(CONFIG.RASTERIZE_TIMEOUT_MS).toBeGreaterThan(60_000)
    expect(CONFIG.RASTERIZE_MAX_PAGES).toBeGreaterThan(0)
    expect(typeof CONFIG.PDFTOPPM).toBe('string')
    expect(typeof CONFIG.PDFINFO).toBe('string')
  })

  it('环境变量覆盖默认值', async () => {
    process.env.ONLYOFFICE_HOST = 'https://docs.example.com'
    process.env.ONLYOFFICE_JWT_SECRET = 'test-secret-1234567890'
    process.env.RASTERIZE_THUMB_DPI = '72'
    process.env.RASTERIZE_PAGE_DPI = '150'
    process.env.RASTERIZE_PAGE_PARALLEL = '4'
    const { CONFIG } = await import('../src/config.mjs')
    expect(CONFIG.ONLYOFFICE_HOST).toBe('https://docs.example.com')
    expect(CONFIG.ONLYOFFICE_JWT_SECRET).toBe('test-secret-1234567890')
    expect(CONFIG.RASTERIZE_THUMB_DPI).toBe(72)
    expect(CONFIG.RASTERIZE_PAGE_DPI).toBe(150)
    expect(CONFIG.RASTERIZE_PAGE_PARALLEL).toBe(4)
  })

  it('生产模式下 JWT 缺失应抛错', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ONLYOFFICE_JWT_SECRET
    await expect(import('../src/config.mjs')).rejects.toThrow(/JWT_SECRET/)
  })

  it('非生产模式下 JWT 缺失可使用默认值（开发友好）', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.ONLYOFFICE_JWT_SECRET
    const mod = await import('../src/config.mjs')
    expect(mod.CONFIG.ONLYOFFICE_JWT_SECRET).toMatch(/.{16,}/)
  })
})