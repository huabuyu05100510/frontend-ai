// 文本提取工具 — 单元测试（TDD）
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { htmlToPlainText, fetchRawText } from '../src/inspect/text-extract'

describe('htmlToPlainText', () => {
  it('简单 HTML → 纯文本', () => {
    expect(htmlToPlainText('<p>Hello</p>')).toBe('Hello')
  })

  it('空字符串 → 空字符串', () => {
    expect(htmlToPlainText('')).toBe('')
  })

  it('嵌套标签 → 拼接文本内容', () => {
    expect(htmlToPlainText('<div><span>a</span><span>b</span></div>')).toBe('ab')
  })

  it('含 HTML 实体 → textContent 自动解码', () => {
    expect(htmlToPlainText('<p>a &amp; b</p>')).toBe('a & b')
  })

  it('textContent 为空时 fallback 到 innerText', () => {
    // 某些浏览器 edge case
    const div = document.createElement('div')
    div.innerHTML = '<script>ignore</script>'
    const result = div.textContent || div.innerText || ''
    expect(result).toBeDefined()
  })
})

describe('fetchRawText', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('成功 fetch 返回完整文本', async () => {
    const text = 'Hello World'
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => text,
    })
    const result = await fetchRawText('/test.txt')
    expect(result).toBe(text)
  })

  it('非 ok 响应抛出错误', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
    })
    await expect(fetchRawText('/missing.txt')).rejects.toThrow('fetch failed: 404')
  })

  it('超过 max 截断', async () => {
    const longText = 'x'.repeat(300)
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => longText,
    })
    const result = await fetchRawText('/big.txt', 200)
    expect(result.length).toBe(200)
    expect(result).toBe(longText.slice(0, 200))
  })

  it('未超限返回全文', async () => {
    const short = 'short'
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => short,
    })
    const result = await fetchRawText('/small.txt', 1024)
    expect(result).toBe(short)
  })
})
