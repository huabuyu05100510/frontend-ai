import { describe, it, expect } from 'vitest'
import { handleServerMessage } from '../CollabClient'
import { CollabDoc } from '../CollabDoc'

describe('handleServerMessage（纯函数：把服务端消息合并进本地 CollabDoc）', () => {
  it('snapshot 全量合并', () => {
    const doc = new CollabDoc<number>('me')
    const changed = handleServerMessage(doc, {
      t: 'snapshot',
      snapshot: { a: { value: 1, ts: 3, client: 'x', deleted: false } },
    })
    expect(changed).toBe(true)
    expect(doc.get('a')).toBe(1)
  })

  it('op 单条合并', () => {
    const doc = new CollabDoc<string>('me')
    const changed = handleServerMessage(doc, {
      t: 'op',
      update: { key: 'k', value: 'hi', ts: 2, client: 'remote', deleted: false },
    })
    expect(changed).toBe(true)
    expect(doc.get('k')).toBe('hi')
  })

  it('op 删除合并为墓碑', () => {
    const doc = new CollabDoc<string>('me')
    doc.set('k', 'v')
    handleServerMessage(doc, {
      t: 'op',
      update: { key: 'k', value: undefined, ts: 99, client: 'remote', deleted: true },
    })
    expect(doc.get('k')).toBeUndefined()
  })

  it('远端较旧的 op 不改变本地存活值', () => {
    const doc = new CollabDoc<string>('me')
    doc.set('k', 'local-new') // ts=1, client 'me'
    // 远端 ts=1, client 'aaa' < 'me' → 不应覆盖
    handleServerMessage(doc, {
      t: 'op',
      update: { key: 'k', value: 'remote-old', ts: 1, client: 'aaa', deleted: false },
    })
    expect(doc.get('k')).toBe('local-new')
  })

  it('未知消息类型返回 false', () => {
    const doc = new CollabDoc<number>('me')
    expect(handleServerMessage(doc, { t: 'awareness', from: 'x', state: {} } as any)).toBe(false)
  })
})
