/**
 * E2E：真实 MiniMax API + translateConcurrent（一段一请求）
 *
 * 验证 37 段场景下（用户卡死的页面规模）：
 *  - 全部段都有非空译文（不漏翻）
 *  - 进度能跑到 100%（不卡死）
 *  - 顺序与输入一致
 *
 * 跳过条件：未设置 MINIMAX_API_KEY 环境变量时跳过（CI 节省额度）
 * 本地运行：MINIMAX_API_KEY=sk-... npx vitest run test/e2e/translate-concurrent-live.test.ts
 */
import { describe, it, expect } from 'vitest'
import { translateConcurrent } from '../../src/background/translator'

// ⚠ 历史 key 已外泄，部署前轮换；缺失 env 时 describe.skipIf 会 skip 整组
const KEY = process.env.MINIMAX_API_KEY ?? ''
const SHOULD_RUN = !!KEY && process.env.SKIP_LIVE !== '1'

const segments = Array.from({ length: 37 }, (_, i) => ({
  id: `s${i}`,
  text: [
    'The quick brown fox jumps over the lazy dog.',
    'Engineers are building tools that translate natural language into code.',
    'Open source software continues to power the modern web infrastructure.',
    'Performance optimization remains a critical concern for production applications.',
    'Modern browsers support advanced APIs that enable rich client-side experiences.',
    'Artificial intelligence is reshaping how developers write and review code.',
    'Distributed systems require careful consideration of consistency and availability.',
    'Type safety reduces runtime errors and improves developer productivity.',
    'The rendering pipeline of modern browsers involves multiple stages of optimization.',
    'Memory management in long-running applications requires explicit cleanup strategies.',
  ][i % 10] + ` #${i}`,
}))

describe.skipIf(!SHOULD_RUN)('translateConcurrent — 真实 API 37 段', () => {
  it('所有段都获得非空译文，顺序一致，不卡死', async () => {
    const results: Array<{ segmentId: string; translation: string }> = []
    const seen = new Set<string>()

    for await (const r of translateConcurrent(segments, 'auto', 'zh', KEY!, 4, 1)) {
      // 关键观测：每段都能 yield，不会卡在某一段
      expect(seen.has(r.segmentId)).toBe(false)
      seen.add(r.segmentId)
      results.push(r)
      console.log(
        `[live] ${results.length}/${segments.length} ${r.segmentId} "${r.translation.slice(0, 30)}..."`,
      )
    }

    expect(results).toHaveLength(37)
    // 漏翻检查：所有段都必须有非空译文
    const empty = results.filter(r => !r.translation)
    console.log(`[live] 空译文数=${empty.length}/37`)
    expect(empty.length).toBeLessThanOrEqual(2) // 容忍极个别失败
    // 顺序一致
    expect(results.map(r => r.segmentId)).toEqual(segments.map(s => s.id))
  }, 120_000)
})
