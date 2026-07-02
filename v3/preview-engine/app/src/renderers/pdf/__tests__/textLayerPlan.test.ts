import { describe, it, expect } from 'vitest'
import { planTextLayer } from '../textLayerPlan'

describe('planTextLayer（文字层调度决策）', () => {
  it('cancelled=true → 不调度，reason=cancelled', () => {
    expect(planTextLayer({ cancelled: true, hasDiv: true, hasPage: true }))
      .toEqual({ proceed: false, reason: 'cancelled' })
  })

  it('hasDiv=false → 不调度，reason=no-div', () => {
    expect(planTextLayer({ cancelled: false, hasDiv: false, hasPage: true }))
      .toEqual({ proceed: false, reason: 'no-div' })
  })

  it('hasPage=false → 不调度，reason=no-page（bitmap 命中但 LRU 已淘汰的场景）', () => {
    expect(planTextLayer({ cancelled: false, hasDiv: true, hasPage: false }))
      .toEqual({ proceed: false, reason: 'no-page' })
  })

  it('全部就绪 → 调度', () => {
    expect(planTextLayer({ cancelled: false, hasDiv: true, hasPage: true }))
      .toEqual({ proceed: true })
  })

  it('cancelled 优先级最高（即使其它都具备也放弃）', () => {
    expect(planTextLayer({ cancelled: true, hasDiv: false, hasPage: false }))
      .toEqual({ proceed: false, reason: 'cancelled' })
  })

  it('纯函数：相同输入 → 相同输出（无副作用）', () => {
    const a = planTextLayer({ cancelled: false, hasDiv: true, hasPage: true })
    const b = planTextLayer({ cancelled: false, hasDiv: true, hasPage: true })
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // 不同对象实例
  })
})
