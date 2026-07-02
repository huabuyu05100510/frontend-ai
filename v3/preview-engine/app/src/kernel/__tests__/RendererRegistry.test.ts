import { describe, it, expect } from 'vitest'
import { RendererRegistry } from '../RendererRegistry'
import type { RendererPlugin } from '../RendererPlugin'
import type { ProbeResult } from '../types'

function p(category: ProbeResult['category'], realType = 'x'): ProbeResult {
  return { ext: realType, realType, container: null, category, trusted: true }
}

function stub(name: string, scorer: (probe: ProbeResult) => number): RendererPlugin {
  return {
    name,
    match: scorer,
    capabilities: () => [],
  }
}

describe('RendererRegistry（插件 match 打分路由）', () => {
  it('选中 match 分最高的插件', () => {
    const reg = new RendererRegistry()
    reg.register(stub('pdf', (pr) => (pr.category === 'paged' ? 0.9 : 0)))
    reg.register(stub('generic', () => 0.1))
    const r = reg.resolve(p('paged'))
    expect(r?.name).toBe('pdf')
  })

  it('无插件命中（全 0 分）返回 null', () => {
    const reg = new RendererRegistry()
    reg.register(stub('pdf', (pr) => (pr.category === 'paged' ? 0.9 : 0)))
    expect(reg.resolve(p('media'))).toBeNull()
  })

  it('同分时先注册者优先（稳定）', () => {
    const reg = new RendererRegistry()
    reg.register(stub('first', () => 0.5))
    reg.register(stub('second', () => 0.5))
    expect(reg.resolve(p('flow'))?.name).toBe('first')
  })

  it('按类别区分：不同 probe 命中不同插件', () => {
    const reg = new RendererRegistry()
    reg.register(stub('paged', (pr) => (pr.category === 'paged' ? 1 : 0)))
    reg.register(stub('sheet', (pr) => (pr.category === 'sheet' ? 1 : 0)))
    expect(reg.resolve(p('paged'))?.name).toBe('paged')
    expect(reg.resolve(p('sheet'))?.name).toBe('sheet')
  })

  it('list() 返回已注册插件', () => {
    const reg = new RendererRegistry()
    reg.register(stub('a', () => 1))
    reg.register(stub('b', () => 1))
    expect(reg.list().map((x) => x.name)).toEqual(['a', 'b'])
  })
})
