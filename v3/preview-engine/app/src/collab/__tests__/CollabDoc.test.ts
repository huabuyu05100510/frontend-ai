import { describe, it, expect } from 'vitest'
import { CollabDoc } from '../CollabDoc'

describe('CollabDoc（LWW-Map CRDT）', () => {
  it('并发修改同一 key：双方合并后收敛到同一确定值', () => {
    const a = new CollabDoc('A')
    const b = new CollabDoc('B')
    const ua = a.set('k', 'fromA') // ts=1, client A
    const ub = b.set('k', 'fromB') // ts=1, client B
    a.applyUpdate(ub)
    b.applyUpdate(ua)
    // 平局按 clientId 决胜（B > A），双方一致
    expect(a.get('k')).toBe(b.get('k'))
    expect(a.get('k')).toBe('fromB')
  })

  it('后写覆盖先写（Lamport 时钟递增）', () => {
    const a = new CollabDoc('A')
    const b = new CollabDoc('B')
    const u1 = a.set('k', 'v1')
    b.applyUpdate(u1)
    const u2 = b.set('k', 'v2') // b 收到 u1 后再写，ts 更大
    a.applyUpdate(u2)
    expect(a.get('k')).toBe('v2')
    expect(b.get('k')).toBe('v2')
  })

  it('删除是带时间戳的墓碑，晚于写入则删除生效', () => {
    const a = new CollabDoc('A')
    a.set('k', 'v')
    const del = a.delete('k')
    expect(a.get('k')).toBeUndefined()
    const b = new CollabDoc('B')
    b.set('k', 'other') // ts=1
    b.applyUpdate(del) // 删除 ts 更大 → 生效
    expect(b.get('k')).toBeUndefined()
  })

  it('applyUpdate 幂等：重复应用同一更新不改变状态', () => {
    const a = new CollabDoc('A')
    const u = a.set('k', 'v')
    const b = new CollabDoc('B')
    b.applyUpdate(u)
    b.applyUpdate(u)
    b.applyUpdate(u)
    expect(b.get('k')).toBe('v')
    expect(b.entries()).toHaveLength(1)
  })

  it('交换律：不同到达顺序结果一致', () => {
    const mk = () => {
      const x = new CollabDoc('A')
      const y = new CollabDoc('B')
      return { x, y }
    }
    const src = new CollabDoc('Z')
    const u1 = src.set('a', 1)
    const u2 = src.set('b', 2)
    const u3 = src.set('a', 3)

    const { x } = mk()
    x.applyUpdate(u1)
    x.applyUpdate(u2)
    x.applyUpdate(u3)

    const { y } = mk()
    y.applyUpdate(u3)
    y.applyUpdate(u1)
    y.applyUpdate(u2)

    expect(x.snapshot()).toEqual(y.snapshot())
    expect(x.get('a')).toBe(3)
    expect(x.get('b')).toBe(2)
  })

  it('离线编辑后整状态合并 → 最终一致', () => {
    const online = new CollabDoc('online')
    const offline = new CollabDoc('offline')
    // 离线期间各自编辑不同 key
    online.set('annot1', 'highlight')
    offline.set('annot2', 'note')
    offline.set('annot3', 'box')
    // 重新连接：双向 merge 全量状态
    online.merge(offline.snapshot())
    offline.merge(online.snapshot())
    expect(online.snapshot()).toEqual(offline.snapshot())
    expect(online.get('annot1')).toBe('highlight')
    expect(online.get('annot2')).toBe('note')
    expect(online.get('annot3')).toBe('box')
  })

  it('并发编辑不同 key 互不干扰', () => {
    const a = new CollabDoc('A')
    const b = new CollabDoc('B')
    const ua = a.set('x', 10)
    const ub = b.set('y', 20)
    a.applyUpdate(ub)
    b.applyUpdate(ua)
    expect(a.get('x')).toBe(10)
    expect(a.get('y')).toBe(20)
    expect(b.get('x')).toBe(10)
    expect(b.get('y')).toBe(20)
  })

  it('结合律：(merge A,B) 与 (merge B,A) 状态相同', () => {
    const base1 = new CollabDoc('1')
    const base2 = new CollabDoc('2')
    const s1 = new CollabDoc('s')
    s1.set('k', 'a')
    const s2 = new CollabDoc('t')
    s2.set('k', 'b')

    base1.merge(s1.snapshot())
    base1.merge(s2.snapshot())

    base2.merge(s2.snapshot())
    base2.merge(s1.snapshot())

    expect(base1.snapshot()).toEqual(base2.snapshot())
  })
})
