import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoom, applyUpdate, snapshot } from '../room.mjs'

const up = (key, value, ts, client, deleted = false) => ({ key, value, ts, client, deleted })

test('新键写入返回 true，快照含该键', () => {
  const r = createRoom()
  assert.equal(applyUpdate(r, up('a', 1, 1, 'c1')), true)
  assert.deepEqual(snapshot(r).a, { value: 1, ts: 1, client: 'c1', deleted: false })
})

test('更小 Lamport 时钟不覆盖（返回 false）', () => {
  const r = createRoom()
  applyUpdate(r, up('a', 'new', 5, 'c1'))
  assert.equal(applyUpdate(r, up('a', 'old', 3, 'c2')), false)
  assert.equal(snapshot(r).a.value, 'new')
})

test('更大 Lamport 时钟覆盖', () => {
  const r = createRoom()
  applyUpdate(r, up('a', 'v1', 1, 'c1'))
  assert.equal(applyUpdate(r, up('a', 'v2', 2, 'c1')), true)
  assert.equal(snapshot(r).a.value, 'v2')
})

test('时钟相等时按 clientId 字典序大者胜', () => {
  const r = createRoom()
  applyUpdate(r, up('a', 'fromB', 4, 'B'))
  assert.equal(applyUpdate(r, up('a', 'fromA', 4, 'A')), false) // A < B 不胜
  assert.equal(applyUpdate(r, up('a', 'fromC', 4, 'C')), true) // C > B 胜
  assert.equal(snapshot(r).a.value, 'fromC')
})

test('删除以墓碑形式保留（LWW）', () => {
  const r = createRoom()
  applyUpdate(r, up('a', 1, 1, 'c1'))
  applyUpdate(r, up('a', undefined, 2, 'c1', true))
  assert.equal(snapshot(r).a.deleted, true)
})

test('幂等：重复投递同一更新结果不变', () => {
  const r = createRoom()
  const u = up('a', 1, 1, 'c1')
  applyUpdate(r, u)
  applyUpdate(r, u)
  assert.equal(Object.keys(snapshot(r)).length, 1)
})
