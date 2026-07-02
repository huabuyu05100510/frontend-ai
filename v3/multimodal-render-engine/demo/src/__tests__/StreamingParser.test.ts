import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StreamingParser } from '../scenes/streaming/StreamingParser'

describe('增量 Markdown 解析', () => {
  it('追加 heading chunk 后 tokens 包含 heading', () => {
    const parser = new StreamingParser()
    parser.append('# Hello World\n\n')
    const tokens = parser.getTokens()
    const heading = tokens.find(t => t.type === 'heading')
    expect(heading).toBeDefined()
    expect(heading?.text).toContain('Hello World')
  })

  it('分片追加 heading：## Ti + tle → depth=2', () => {
    const parser = new StreamingParser()
    parser.append('## Ti')
    parser.append('tle\n\n')
    const tokens = parser.getTokens()
    const heading = tokens.find(t => t.type === 'heading')
    expect(heading?.depth).toBe(2)
  })

  it('renderedLength 在 commit 后正确推进', () => {
    const parser = new StreamingParser()
    parser.append('Hello world\n\n')
    expect(parser.renderedLength).toBe(0)
    parser.commit()
    expect(parser.renderedLength).toBeGreaterThan(0)
  })

  it('commit 前后 getNewTokens 只返回增量', () => {
    const parser = new StreamingParser()
    parser.append('# Title\n\n')
    parser.commit()
    const firstBatch = parser.getNewTokens()
    expect(firstBatch.length).toBeGreaterThan(0)

    parser.append('Paragraph text\n\n')
    parser.commit()
    const secondBatch = parser.getNewTokens()
    // 第二批只包含新增的 paragraph，不包含已提交的 heading
    expect(secondBatch.every(t => t.type !== 'heading')).toBe(true)
  })

  it('代码块 chunk 渲染为 code token', () => {
    const parser = new StreamingParser()
    parser.append('```js\nconst x = 1\n```\n\n')
    const tokens = parser.getTokens()
    expect(tokens.some(t => t.type === 'code')).toBe(true)
  })

  it('追加空字符串不改变 token 数', () => {
    const parser = new StreamingParser()
    parser.append('# Title\n\n')
    const before = parser.getTokens().length
    parser.append('')
    expect(parser.getTokens().length).toBe(before)
  })
})
