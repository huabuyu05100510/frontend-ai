import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { PerfCollector } from '../perf/PerfCollector'

describe('PerfCollector', () => {
  let collector: PerfCollector

  beforeEach(() => {
    vi.useFakeTimers()
    collector = new PerfCollector()
  })

  afterEach(() => {
    collector.stop()
    vi.useRealTimers()
  })

  test('初始 snapshot 全为 0', () => {
    const s = collector.getSnapshot()
    expect(s.fps).toBe(0)
    expect(s.renderTime).toBe(0)
    expect(s.hitTestTime).toBe(0)
    expect(s.annotationCount).toBe(0)
    expect(s.poolSize).toBe(0)
    expect(s.poolMax).toBe(5)
  })

  test('recordRender 更新 renderTime', () => {
    collector.recordRender(3.5)
    expect(collector.getSnapshot().renderTime).toBe(3.5)
  })

  test('recordHitTest 更新 hitTestTime', () => {
    collector.recordHitTest(0.4)
    expect(collector.getSnapshot().hitTestTime).toBe(0.4)
  })

  test('setAnnotationCount 更新 annotationCount', () => {
    collector.setAnnotationCount(127)
    expect(collector.getSnapshot().annotationCount).toBe(127)
  })

  test('setPoolStatus 更新 poolSize 和 poolMax', () => {
    collector.setPoolStatus(3, 5)
    const s = collector.getSnapshot()
    expect(s.poolSize).toBe(3)
    expect(s.poolMax).toBe(5)
  })

  test('subscribe 在数据变化后（500ms内）回调', () => {
    const fn = vi.fn()
    collector.subscribe(fn)
    collector.recordRender(2.0)
    // 触发 500ms 批量通知
    vi.advanceTimersByTime(550)
    expect(fn).toHaveBeenCalled()
    const snapshot = fn.mock.calls[0][0]
    expect(snapshot.renderTime).toBe(2.0)
  })

  test('subscribe 返回 unsubscribe，调用后不再接收通知', () => {
    const fn = vi.fn()
    const unsub = collector.subscribe(fn)
    unsub()
    collector.recordRender(9.9)
    vi.advanceTimersByTime(550)
    expect(fn).not.toHaveBeenCalled()
  })

  test('stop 后不再触发 interval 通知', () => {
    const fn = vi.fn()
    collector.subscribe(fn)
    collector.stop()
    collector.recordRender(1.0)
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
