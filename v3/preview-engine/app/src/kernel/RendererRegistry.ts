import type { ProbeResult } from './types'
import type { RendererPlugin } from './RendererPlugin'

// ============================================================================
// RendererRegistry — 插件注册 + match 打分路由
//   resolve 选出 match 分最高的插件；同分时先注册者优先（稳定）。
// ============================================================================

export class RendererRegistry {
  private plugins: RendererPlugin[] = []

  register(plugin: RendererPlugin): void {
    this.plugins.push(plugin)
  }

  list(): RendererPlugin[] {
    return [...this.plugins]
  }

  resolve(probe: ProbeResult): RendererPlugin | null {
    let best: RendererPlugin | null = null
    let bestScore = 0
    for (const plugin of this.plugins) {
      const score = plugin.match(probe)
      if (score > bestScore) {
        bestScore = score
        best = plugin
      }
    }
    return best
  }
}
