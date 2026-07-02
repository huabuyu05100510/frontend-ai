import { describe, it, expect, vi } from 'vitest'
import { ProgressiveLoader } from '../ProgressiveLoader'
import type { ProgressiveStage } from '../../kernel/types'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ProgressiveLoader（三段式渐进首屏）', () => {
  it('按 idle→skeleton→lqip→hires-loading→hires-ready 顺序推进，状态可观测', async () => {
    const stages: ProgressiveStage[] = []
    const skeleton = deferred<void>()
    const lqip = deferred<string>()
    const hires = deferred<string>()

    const loader = new ProgressiveLoader({
      loadSkeleton: () => skeleton.promise,
      loadLQIP: () => lqip.promise,
      loadHiRes: () => hires.promise,
    })
    loader.on((s) => stages.push(s.stage))

    const done = loader.start()
    expect(loader.stage).toBe('skeleton')

    skeleton.resolve()
    await Promise.resolve()
    expect(loader.stage).toBe('lqip')

    lqip.resolve('data:image/webp;lqip')
    await Promise.resolve()
    expect(loader.stage).toBe('hires-loading')
    expect(loader.lqip).toBe('data:image/webp;lqip')

    hires.resolve('hires-bitmap')
    await done
    expect(loader.stage).toBe('hires-ready')
    expect(loader.hires).toBe('hires-bitmap')
    expect(stages).toEqual(['skeleton', 'lqip', 'hires-loading', 'hires-ready'])
  })

  it('「可见」发生在 LQIP：firstVisibleAt 在 LQIP 就绪时记录', async () => {
    let clock = 0
    const now = () => clock
    const lqip = deferred<string>()
    const loader = new ProgressiveLoader({
      loadSkeleton: () => Promise.resolve(),
      loadLQIP: () => lqip.promise,
      loadHiRes: () => new Promise<string>(() => {}), // 高清永不结束
      now,
    })
    loader.start()
    await Promise.resolve()
    await Promise.resolve()
    clock = 90
    lqip.resolve('lqip')
    await Promise.resolve()
    expect(loader.firstVisibleAt).toBe(90) // 90ms 即可见，不等高清
  })

  it('LQIP 缺失（未预渲染）时跳过，仍能到达 hires-ready', async () => {
    const loader = new ProgressiveLoader({
      loadSkeleton: () => Promise.resolve(),
      loadLQIP: undefined, // 没有预渲染封面
      loadHiRes: () => Promise.resolve('hi'),
    })
    await loader.start()
    expect(loader.stage).toBe('hires-ready')
    expect(loader.lqip).toBeNull()
    expect(loader.hires).toBe('hi')
  })

  it('高清失败 → error 状态，但保留 LQIP 兜底可见', async () => {
    const loader = new ProgressiveLoader({
      loadSkeleton: () => Promise.resolve(),
      loadLQIP: () => Promise.resolve('lqip'),
      loadHiRes: () => Promise.reject(new Error('decode failed')),
    })
    await loader.start()
    expect(loader.stage).toBe('error')
    expect(loader.lqip).toBe('lqip') // 用户仍看得到低清
  })

  it('cancel 后不再推进状态', async () => {
    const lqip = deferred<string>()
    const loader = new ProgressiveLoader({
      loadSkeleton: () => Promise.resolve(),
      loadLQIP: () => lqip.promise,
      loadHiRes: () => Promise.resolve('hi'),
    })
    loader.start()
    await Promise.resolve()
    loader.cancel()
    lqip.resolve('lqip')
    await Promise.resolve()
    expect(loader.stage).not.toBe('hires-ready')
    expect(loader.lqip).toBeNull()
  })

  it('重复 start 幂等（不重复触发）', async () => {
    const loadHiRes = vi.fn(() => Promise.resolve('hi'))
    const loader = new ProgressiveLoader({
      loadSkeleton: () => Promise.resolve(),
      loadHiRes,
    })
    const p1 = loader.start()
    const p2 = loader.start()
    await Promise.all([p1, p2])
    expect(loadHiRes).toHaveBeenCalledTimes(1)
  })
})
