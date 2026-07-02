import { describe, it, expect } from 'vitest'
import { ViewportScheduler } from '../ViewportScheduler'
import { CumulativeIndex } from '../CumulativeIndex'

function scheduler(count = 100, overscan = 2) {
  const idx = new CumulativeIndex(count, () => 100)
  return new ViewportScheduler(idx, { overscan })
}

describe('ViewportScheduler', () => {
  it('首次更新：可见集 + 前后预取窗口，无回收', () => {
    const s = scheduler()
    const plan = s.update(0, 300)
    expect(plan.visible).toEqual([0, 1, 2])
    expect(plan.prefetch).toEqual([3, 4]) // 头部被夹紧，仅向后预取
    expect(plan.recycle).toEqual([])
  })

  it('滚动后：旧的活跃单元进回收集', () => {
    const s = scheduler()
    s.update(0, 300) // active {0..4}
    const plan = s.update(1000, 300) // visible {10,11,12}
    expect(plan.visible).toEqual([10, 11, 12])
    expect(plan.prefetch).toEqual([8, 9, 13, 14])
    // 旧 {0,1,2,3,4} 全部不在新窗口 → 回收
    expect(plan.recycle.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('小幅滚动：重叠单元不回收也不重复渲染', () => {
    const s = scheduler()
    s.update(0, 300) // active {0,1,2,3,4}
    const plan = s.update(100, 300) // visible {1,2,3} prefetch {0,4,5} → active {0..5}
    expect(plan.visible).toEqual([1, 2, 3])
    expect(plan.recycle).toEqual([]) // 0..4 仍在新 active 内
    expect(plan.prefetch.sort((a, b) => a - b)).toEqual([0, 4, 5])
  })

  it('滚到末尾：预取窗口右侧被夹紧', () => {
    const s = scheduler(20, 2)
    const plan = s.update(1700, 300) // visible {17,18,19}
    expect(plan.visible).toEqual([17, 18, 19])
    expect(plan.prefetch).toEqual([15, 16]) // 右侧无更多单元
  })

  it('已渲染的可见单元不会重复出现在 visible（只报需要新渲染的）', () => {
    const s = scheduler()
    s.update(0, 300)
    const plan = s.update(0, 300) // 完全相同的视口
    expect(plan.visible).toEqual([]) // 0,1,2 已渲染，无需重渲
    expect(plan.recycle).toEqual([])
  })

  it('overscan=0 时无预取', () => {
    const idx = new CumulativeIndex(50, () => 100)
    const s = new ViewportScheduler(idx, { overscan: 0 })
    const plan = s.update(500, 200)
    expect(plan.prefetch).toEqual([])
    expect(plan.visible).toEqual([5, 6])
  })

  it('rendered() 反映当前已就绪单元集合', () => {
    const s = scheduler()
    s.update(0, 300)
    expect(s.rendered().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })
})
