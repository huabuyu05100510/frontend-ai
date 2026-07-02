import { describe, it, expect, vi } from 'vitest'
import { createAbortableStream } from '../scenes/streaming/useAbortableStream'

describe('竞态防护', () => {
  it('第二次 start 后，第一次的 signal.aborted === true', () => {
    const stream = createAbortableStream()
    const ctrl1 = stream.start()
    const ctrl2 = stream.start()
    expect(ctrl1.signal.aborted).toBe(true)
    expect(ctrl2.signal.aborted).toBe(false)
  })

  it('旧 version 的 onData 不更新外部 state', () => {
    const stream = createAbortableStream()
    let uiValue = ''

    stream.start()            // version=1
    const version1 = stream.currentVersion

    stream.start()            // version=2，version1 已过期

    // 模拟旧请求回调：version=1（已过期）
    const shouldUpdate = stream.isCurrentVersion(version1)
    if (shouldUpdate) uiValue = 'old data'

    expect(uiValue).toBe('')  // 旧 version 不应更新 UI
  })

  it('当前 version 的 onData 可以更新 state', () => {
    const stream = createAbortableStream()
    let uiValue = ''

    stream.start()
    const currentVersion = stream.currentVersion

    const shouldUpdate = stream.isCurrentVersion(currentVersion)
    if (shouldUpdate) uiValue = 'new data'

    expect(uiValue).toBe('new data')
  })

  it('abort 后 signal 立即变为 aborted', () => {
    const stream = createAbortableStream()
    const ctrl = stream.start()
    expect(ctrl.signal.aborted).toBe(false)
    stream.abort()
    expect(ctrl.signal.aborted).toBe(true)
  })

  it('连续 start 三次，只有最后一次 version 为 current', () => {
    const stream = createAbortableStream()
    const v1 = stream.start().signal
    const v2Start = stream.currentVersion
    stream.start()
    const v3Start = stream.currentVersion
    stream.start()

    expect(stream.isCurrentVersion(v2Start)).toBe(false)
    expect(stream.isCurrentVersion(v3Start)).toBe(false)
    expect(stream.isCurrentVersion(stream.currentVersion)).toBe(true)
  })
})
