import { describe, it, expect } from 'vitest'
import { createTrackerState, trackBracketDepth } from '../scenes/streaming/BracketDepthTracker'

describe('括号深度计数', () => {
  it('单 chunk 完整 JSON → complete=true, depth=0', () => {
    const state = createTrackerState()
    const result = trackBracketDepth('{"a":1}', state)
    expect(result.complete).toBe(true)
    expect(result.depth).toBe(0)
    expect(JSON.parse(result.buf)).toEqual({ a: 1 })
  })

  it('分两次到达：第一次 incomplete，第二次 complete', () => {
    const state = createTrackerState()
    const r1 = trackBracketDepth('{"a":', state)
    expect(r1.complete).toBe(false)
    expect(r1.depth).toBe(1)

    const r2 = trackBracketDepth('1}', state)
    expect(r2.complete).toBe(true)
    expect(JSON.parse(r2.buf)).toEqual({ a: 1 })
  })

  it('嵌套 JSON：只在最外层闭合时 complete=true', () => {
    const state = createTrackerState()
    trackBracketDepth('{"a":{', state)
    trackBracketDepth('"b":1}', state)
    expect(state.complete).toBe(false)
    const final = trackBracketDepth('}', state)
    expect(final.complete).toBe(true)
  })

  it('字符串内的 { 不影响 depth', () => {
    const state = createTrackerState()
    const result = trackBracketDepth('{"key":"{value}"}', state)
    expect(result.complete).toBe(true)
    expect(result.depth).toBe(0)
  })

  it('空 chunk 不改变状态', () => {
    const state = createTrackerState()
    trackBracketDepth('{"a":', state)
    const depthBefore = state.depth
    trackBracketDepth('', state)
    expect(state.depth).toBe(depthBefore)
    expect(state.complete).toBe(false)
  })

  it('空对象 {} → complete=true', () => {
    const state = createTrackerState()
    const result = trackBracketDepth('{}', state)
    expect(result.complete).toBe(true)
  })

  it('多个 chunk 分片，最终 buf 可 JSON.parse', () => {
    const state = createTrackerState()
    const chunks = ['{"name"', ':"render_poi', '_card","ar', 'gs":{"title"', ':"故宫博物院"}}']
    for (const chunk of chunks) trackBracketDepth(chunk, state)
    expect(state.complete).toBe(true)
    const parsed = JSON.parse(state.buf)
    expect(parsed.name).toBe('render_poi_card')
    expect(parsed.args.title).toBe('故宫博物院')
  })
})
